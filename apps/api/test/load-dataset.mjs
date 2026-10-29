import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export function loadDatasetPlan(profile = 'representative') {
  const volumes = {
    smoke: [
      [12, 30],
      [20, 100],
      [50, 300],
    ],
    representative: [
      [20, 300],
      [100, 3000],
      [500, 30000],
    ],
    large: [
      [100, 1000],
      [500, 10000],
      [2000, 100000],
    ],
  };
  assert.ok(
    Object.hasOwn(volumes, profile),
    'Choose smoke, representative or large for LOAD_DATASET_PROFILE.',
  );
  return {
    version: 1,
    profile,
    historyDays: 180,
    assumption:
      'Local expected-use planning baseline; not a measured production forecast.',
    tenants: volumes[profile].map(([products, orders], i) => ({
      tier: ['small', 'medium', 'large'][i],
      products,
      orders,
      categories: [2, 5, 15][i],
      tables: [2, 10, 40][i],
      roles: {
        OWNER: 1,
        ADMIN: 1,
        MANAGER: i === 2 ? 2 : 1,
        CASHIER: [1, 2, 4][i],
        KITCHEN: [1, 2, 4][i],
      },
    })),
  };
}

export async function seedLoadCatalog(
  prisma,
  plan,
  { runId, password, passwordHash },
) {
  const shops = [],
    accounts = [];
  for (const tenant of plan.tenants) {
    const shop = await prisma.shop.create({
      data: {
        name: `Synthetic ${tenant.tier} shop`,
        slug: `load-${tenant.tier}-${runId}`,
      },
    });
    const actors = {};
    for (const [role, count] of Object.entries(tenant.roles)) {
      for (let index = 0; index < count; index++) {
        const email = `${role.toLowerCase()}-${index}-${tenant.tier}-${runId}@load.example.test`;
        const user = await prisma.user.create({
          data: { email, passwordHash, firstName: 'Synthetic', lastName: role },
        });
        await prisma.shopMember.create({
          data: { userId: user.id, shopId: shop.id, role },
        });
        actors[role] ??= user.id;
        if (role === 'OWNER')
          accounts.push({ email, password, shopId: shop.id });
      }
    }
    const categories = [];
    for (let i = 0; i < tenant.categories; i++)
      categories.push(
        await prisma.category.create({
          data: {
            shopId: shop.id,
            name: `Synthetic category ${i}`,
            slug: `category-${i}`,
            sortOrder: i,
            isVisible: i !== tenant.categories - 1,
          },
        }),
      );
    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        categoryId: categories[0].id,
        name: 'Synthetic coffee',
        slug: 'coffee',
        price: '10.00',
        sortOrder: 0,
      },
    });
    const rows = Array.from({ length: tenant.products - 1 }, (_, index) => ({
      id: randomUUID(),
      shopId: shop.id,
      categoryId: categories[index % categories.length].id,
      name: `Synthetic item ${index + 1}`,
      slug: `item-${index + 1}`,
      sortOrder: index + 1,
      price: `${10 + (index % 25)}.50`,
      status:
        index % 17 === 0
          ? 'HIDDEN'
          : index % 7 === 0
            ? 'SOLD_OUT'
            : 'AVAILABLE',
      isArchived: index % 41 === 0,
    }));
    for (let offset = 0; offset < rows.length; offset += 500)
      await prisma.product.createMany({
        data: rows.slice(offset, offset + 500),
      });
    const variant = await prisma.productVariant.create({
      data: {
        shopId: shop.id,
        productId: product.id,
        name: 'Large',
        priceAdjustment: '1.50',
      },
    });
    const addOn = await prisma.addOn.create({
      data: {
        shopId: shop.id,
        name: 'Synthetic extra',
        priceAdjustment: '2.00',
      },
    });
    await prisma.productAddOn.create({
      data: { shopId: shop.id, productId: product.id, addOnId: addOn.id },
    });
    await prisma.restaurantTable.createMany({
      data: Array.from({ length: tenant.tables }, (_, i) => ({
        shopId: shop.id,
        number: i % 2 ? `Patio ${i + 1}` : `Table ${i + 1}`,
        code: `T${i + 1}`,
      })),
    });
    shops.push({ ...shop, product, variant, addOn, actors, plan: tenant });
  }
  return { shops, accounts };
}

/** Clone only real API-created templates, preserving valid receipt/line snapshots.
 * All tenant FKs, status checks and immutable-payment triggers stay enabled. */
export async function seedLoadHistory(
  db,
  shop,
  sourceIds,
  anchor,
  onStep = () => {},
) {
  const query = async (step, sql, args) => {
    onStep(step);
    return db.query(sql, args);
  };
  const maximum = `ORD-${String(shop.plan.orders).padStart(6, '0')}`;
  const inserted = await query(
    'insert-orders',
    `INSERT INTO orders SELECT cloned.* FROM orders source
    CROSS JOIN generate_series(3,$3::int) n
    JOIN restaurant_tables t ON t."shopId"=$1 AND t.code='T'||((n%$4::int)+1)::text
    CROSS JOIN LATERAL jsonb_populate_record(NULL::orders,to_jsonb(source)||jsonb_build_object(
      'id',gen_random_uuid()::text,'requestId',gen_random_uuid()::text,'orderNumber','ORD-'||lpad(n::text,6,'0'),
      'qrTokenNonce',gen_random_uuid()::text,
      'tableId',CASE WHEN source.mode='DINE_IN' THEN t.id END,
      'tableCode',CASE WHEN source.mode='DINE_IN' THEN t.code END,
      'tableNumber',CASE WHEN source.mode='DINE_IN' THEN t.number END,
      'createdAt',$5::timestamp - CASE WHEN n%20<4 THEN (15+n%120)*interval '1 minute' ELSE (n*37%181)*interval '1 day'+(n%86400)*interval '1 second' END,
      'updatedAt',$5::timestamp)) cloned
    WHERE source."shopId"=$1 AND source.id=($2::text[])[(n%2)+1]`,
    [shop.id, sourceIds, shop.plan.orders, shop.plan.tables, anchor],
  );
  assert.equal(inserted.rowCount, shop.plan.orders - 2);
  await query('analyze-orders', 'ANALYZE orders');
  const args = [shop.id, sourceIds, maximum];
  const cloned = `"shopId"=$1 AND id<>ALL($2::text[]) AND "orderNumber"<=$3`;
  await query(
    'insert-lines',
    `WITH templates AS MATERIALIZED (
      SELECT to_jsonb(line) receipt,source.mode FROM order_items line
      JOIN orders source ON source.id=line."orderId" AND source."shopId"=$1
      WHERE line."shopId"=$1 AND line."orderId"=ANY($2::text[])
    )
    INSERT INTO order_items SELECT cloned_line.* FROM templates line
    JOIN orders target ON target."shopId"=$1 AND target.mode=line.mode AND target.id<>ALL($2::text[]) AND target."orderNumber"<=$3
    CROSS JOIN LATERAL jsonb_populate_record(NULL::order_items,line.receipt||jsonb_build_object(
      'id',gen_random_uuid()::text,'orderId',target.id,'createdAt',target."createdAt")) cloned_line
    `,
    args,
  );
  const ordinal = `substring("orderNumber" from 5)::int%20`;
  await query(
    'reject',
    `UPDATE orders SET status='REJECTED',"decidedAt"="createdAt"+interval '2 minutes',"decidedBy"=$4,
    "qrTokenRevokedAt"="createdAt"+interval '2 minutes',"rejectionReason"='Synthetic rejection'
    WHERE ${cloned} AND ${ordinal}=4`,
    [...args, shop.actors.MANAGER],
  );
  await query(
    'confirm',
    `UPDATE orders SET status='CONFIRMED',"decidedAt"="createdAt"+interval '1 minute',"decidedBy"=$4,
    "qrTokenRevokedAt"="createdAt"+interval '1 minute',"paymentStatus"='PAID',"paymentMethod"='CASH',
    "paymentRequestId"=gen_random_uuid()::text,"paymentReviewVersion"=repeat('a',64),
    "amountReceived"="totalPrice","changeDue"=0,"paidAt"="createdAt"+interval '1 minute',"paidBy"=$4,
    "preparationStatus"='QUEUED',"queuedAt"="createdAt"+interval '1 minute'
    WHERE ${cloned} AND ${ordinal} NOT IN (0,4)`,
    [...args, shop.actors.CASHIER],
  );
  await query(
    'prepare',
    `UPDATE orders SET "preparationStatus"='PREPARING',"preparationStartedAt"="createdAt"+interval '2 minutes',"preparationStartedBy"=$4
    WHERE ${cloned} AND ${ordinal} NOT IN (0,1,4)`,
    [...args, shop.actors.KITCHEN],
  );
  await query(
    'ready',
    `UPDATE orders SET "preparationStatus"='READY',"preparationReadyAt"="createdAt"+interval '5 minutes',"preparationReadyBy"=$4
    WHERE ${cloned} AND ${ordinal} NOT IN (0,1,2,4)`,
    [...args, shop.actors.KITCHEN],
  );
  await query(
    'complete',
    `UPDATE orders SET "preparationStatus"='COMPLETED',"completedAt"="createdAt"+interval '10 minutes',"completedBy"=$4
    WHERE ${cloned} AND ${ordinal}>=5`,
    [...args, shop.actors.KITCHEN],
  );
  await query('sequence', 'UPDATE shops SET "lastOrderNumber"=$2 WHERE id=$1', [
    shop.id,
    shop.plan.orders,
  ]);
}

export async function inspectLoadDataset(db, shops, plan) {
  const tenants = [];
  for (const shop of shops) {
    const {
      rows: [row],
    } = await db.query(
      `SELECT
      (SELECT count(*)::int FROM products WHERE "shopId"=$1) products,
      (SELECT count(*)::int FROM shop_members WHERE "shopId"=$1) staff,
      (SELECT count(*)::int FROM orders WHERE "shopId"=$1) orders,
      (SELECT count(*)::int FROM order_items WHERE "shopId"=$1) lines`,
      [shop.id],
    );
    assert.equal(row.products, shop.plan.products);
    assert.equal(row.orders, shop.plan.orders);
    assert.equal(
      row.staff,
      Object.values(shop.plan.roles).reduce((a, n) => a + n, 0),
    );
    assert.equal(row.lines, row.orders * 2);
    const states = (
      await db.query(
        `SELECT status,"paymentStatus","preparationStatus",mode,count(*)::int records
      FROM orders WHERE "shopId"=$1 GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`,
        [shop.id],
      )
    ).rows;
    for (const state of ['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'])
      assert.ok(states.some((r) => r.status === state));
    for (const state of ['QUEUED', 'PREPARING', 'READY', 'COMPLETED'])
      assert.ok(states.some((r) => r.preparationStatus === state));
    const dates = (
      await db.query(
        `SELECT min("createdAt") AT TIME ZONE 'UTC' oldest,
          max("createdAt") AT TIME ZONE 'UTC' newest FROM orders WHERE "shopId"=$1`,
        [shop.id],
      )
    ).rows[0];
    tenants.push({
      tier: shop.plan.tier,
      ...row,
      roles: shop.plan.roles,
      states,
      history: dates,
    });
  }
  return {
    ...plan,
    actual: tenants,
    totals: tenants.reduce(
      (a, row) => ({
        shops: a.shops + 1,
        users: a.users + row.staff,
        products: a.products + row.products,
        orders: a.orders + row.orders,
        orderLines: a.orderLines + row.lines,
      }),
      { shops: 0, users: 0, products: 0, orders: 0, orderLines: 0 },
    ),
  };
}
