import { Prisma } from '../../src/generated/prisma/client.js';
import type { DemoPlan } from './plan.js';
import { readPriceSnapshot } from '../../src/modules/orders/order-price-snapshots.js';

const batches = <T>(rows: T[], size = 500) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, n) =>
    rows.slice(n * size, (n + 1) * size),
  );

export async function persistShop(
  tx: Prisma.TransactionClient,
  data: DemoPlan['shops'][number],
) {
  await tx.shop.create({ data: data.shop });
  await tx.user.createMany({ data: data.users });
  await tx.shopMember.createMany({ data: data.members });
  await tx.restaurantTable.createMany({ data: data.tables });
  await tx.category.createMany({ data: data.categories });
  await tx.product.createMany({ data: data.products });
  await tx.productOptionGroup.createMany({ data: data.groups });
  await tx.productVariant.createMany({ data: data.variants });
  await tx.addOn.createMany({ data: data.addOns });
  await tx.productAddOn.createMany({ data: data.links });
  for (const batch of batches(data.orders))
    await tx.order.createMany({ data: batch });
  for (const batch of batches(data.items))
    await tx.orderItem.createMany({ data: batch });
  // Saved QUEUED -> PREPARING -> READY -> COMPLETED writes satisfy all SQL guards.
  // JSON parameters keep this set-based without dynamically interpolating SQL identifiers.
  for (const batch of batches(data.timelines)) {
    const rows = batch.filter((row) => row.target !== 'QUEUED');
    if (!rows.length) continue;
    await tx.$executeRaw`
      UPDATE orders o SET "preparationStatus" = 'PREPARING', "preparationStartedAt" = r."startedAt",
        "preparationStartedBy" = r.kitchen, "updatedAt" = r."startedAt"
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(id text, "startedAt" timestamp, kitchen text)
      WHERE o.id = r.id AND o."shopId" = ${data.shop.id} AND o."preparationStatus" = 'QUEUED'`;
    const ready = rows.filter(
      (row) => row.target === 'READY' || row.target === 'COMPLETED',
    );
    if (ready.length)
      await tx.$executeRaw`
      UPDATE orders o SET "preparationStatus" = 'READY', "preparationReadyAt" = r."readyAt",
        "preparationReadyBy" = r.kitchen, "updatedAt" = r."readyAt"
      FROM jsonb_to_recordset(${JSON.stringify(ready)}::jsonb) AS r(id text, "readyAt" timestamp, kitchen text)
      WHERE o.id = r.id AND o."shopId" = ${data.shop.id} AND o."preparationStatus" = 'PREPARING'`;
    const completed = rows.filter((row) => row.target === 'COMPLETED');
    if (completed.length)
      await tx.$executeRaw`
      UPDATE orders o SET "preparationStatus" = 'COMPLETED', "completedAt" = r."completedAt",
        "completedBy" = r.cashier, "updatedAt" = r."completedAt"
      FROM jsonb_to_recordset(${JSON.stringify(completed)}::jsonb) AS r(id text, "completedAt" timestamp, cashier text)
      WHERE o.id = r.id AND o."shopId" = ${data.shop.id} AND o."preparationStatus" = 'READY'`;
  }
}

export async function verifyShop(
  tx: Prisma.TransactionClient,
  data: DemoPlan['shops'][number],
) {
  const shopId = data.shop.id;
  const menuProducts = await tx.product.findMany({
    where: { shopId },
    select: { id: true, imageUrl: true, categoryId: true },
  });
  const categoryIds = new Set(data.categories.map((category) => category.id));
  for (const product of menuProducts) {
    if (!categoryIds.has(product.categoryId!))
      throw new Error('Invalid product category tenant.');
    if (!product.imageUrl) throw new Error('Missing product image/fallback.');
    const url = product.imageUrl;
    if (url.startsWith('/demo-assets/')) {
      if (
        !/^\/demo-assets\/(coffee|tea|milk-tea|pastry|meal|dessert|sandwich|juice)\.svg$/.test(
          url,
        )
      )
        throw new Error('Invalid local fallback.');
    } else {
      const prefix = `${process.env.SUPABASE_URL}/storage/v1/object/public/paserve-assets/shops/${shopId}/products/${product.id}/`;
      if (
        !url.startsWith(prefix) ||
        !/^[a-f0-9-]{36}\.webp$/.test(url.slice(prefix.length))
      )
        throw new Error('Cross-tenant image path.');
    }
  }
  const orders = await tx.order.findMany({
    where: { shopId },
    include: { orderItems: true },
  });
  if (orders.length !== data.orders.length)
    throw new Error('Order count mismatch.');
  const members = new Map(
    data.members.map((member) => [member.userId, member.role]),
  );
  const tables = new Map(data.tables.map((table) => [table.id, table]));
  const products = new Set(data.products.map((product) => product.id));
  const targets = new Map(data.timelines.map((line) => [line.id, line.target]));
  const cashiers = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'];
  const kitchen = ['OWNER', 'ADMIN', 'MANAGER', 'KITCHEN'];
  let paid = 0;
  let revenue = new Prisma.Decimal(0);
  for (const order of orders) {
    if (!cashiers.includes(members.get(order.decidedBy!) ?? ''))
      throw new Error('Invalid decision actor.');
    if (
      order.mode === 'TAKEOUT'
        ? order.tableId !== null ||
          order.tableCode !== null ||
          order.tableNumber !== null
        : !tables.has(order.tableId!) ||
          tables.get(order.tableId!)!.code !== order.tableCode ||
          tables.get(order.tableId!)!.number !== order.tableNumber
    )
      throw new Error('Invalid table tenant/snapshot.');
    const total = order.orderItems.reduce((sum, item) => {
      if (
        item.shopId !== shopId ||
        item.orderId !== order.id ||
        !products.has(item.productId!)
      )
        throw new Error('Cross-tenant item.');
      readPriceSnapshot(item);
      return sum.plus(item.lineTotalSnapshot);
    }, new Prisma.Decimal(0));
    if (!total.equals(order.totalPrice))
      throw new Error('Order total mismatch.');
    if (
      JSON.stringify(order.items) !==
      JSON.stringify(
        order.orderItems
          .sort((a, b) => a.lineNumber - b.lineNumber)
          .map((item) => item.snapshot),
      )
    ) {
      // PostgreSQL jsonb key order differs from JS insertion order: compare canonical keys.
      const canonical = (value: unknown): string =>
        JSON.stringify(value, (_key, node: unknown) =>
          node && typeof node === 'object' && !Array.isArray(node)
            ? Object.fromEntries(
                Object.entries(node).sort(([a], [b]) => a.localeCompare(b)),
              )
            : node,
        );
      if (
        canonical(order.items) !==
        canonical(order.orderItems.map((item) => item.snapshot))
      )
        throw new Error('Receipt item mismatch.');
    }
    if (order.paymentStatus === 'PAID') {
      paid++;
      if (
        !cashiers.includes(members.get(order.paidBy!) ?? '') ||
        !order.amountReceived?.minus(order.changeDue!).equals(total) ||
        order.changeDue!.isNegative()
      )
        throw new Error('Payment mismatch.');
      if (order.preparationStatus !== targets.get(order.id))
        throw new Error('Fulfillment state mismatch.');
      for (const actor of [
        order.preparationStartedBy,
        order.preparationReadyBy,
      ].filter(Boolean))
        if (!kitchen.includes(members.get(actor!) ?? ''))
          throw new Error('Invalid kitchen actor.');
      if (
        order.completedBy &&
        !cashiers.includes(members.get(order.completedBy) ?? '')
      )
        throw new Error('Invalid completion actor.');
      const timeline = [
        order.createdAt,
        order.decidedAt,
        order.queuedAt,
        order.preparationStartedAt,
        order.preparationReadyAt,
        order.completedAt,
      ].filter((date): date is Date => date !== null);
      if (
        timeline.some(
          (date, n) => n > 0 && date.getTime() < timeline[n - 1]!.getTime(),
        )
      )
        throw new Error('Invalid timeline.');
      if (order.preparationStatus === 'COMPLETED')
        revenue = revenue.plus(total);
    }
  }
  const [productCount, categoryCount, memberCount, tableCount, analytics] =
    await Promise.all([
      tx.product.count({ where: { shopId } }),
      tx.category.count({ where: { shopId } }),
      tx.shopMember.count({ where: { shopId } }),
      tx.restaurantTable.count({ where: { shopId } }),
      tx.order.aggregate({
        where: {
          shopId,
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          preparationStatus: 'COMPLETED',
        },
        _sum: { totalPrice: true },
      }),
    ]);
  if (
    productCount !== data.products.length ||
    categoryCount !== data.categories.length ||
    memberCount !== data.members.length ||
    tableCount !== data.tables.length ||
    !analytics._sum.totalPrice?.equals(revenue)
  )
    throw new Error('Count/analytics validation failed.');
  return {
    shop: data.shop.name,
    users: memberCount,
    categories: categoryCount,
    products: productCount,
    tables: tableCount,
    orders: orders.length,
    items: orders.reduce((n, order) => n + order.orderItems.length, 0),
    payments: paid,
    completedSales: revenue.toFixed(2),
  };
}
