import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { AddOnsRepository } from '../dist/modules/add-ons/add-ons.repository.js';
import { AddOnsService } from '../dist/modules/add-ons/add-ons.service.js';
import { ShopMembersRepository } from '../dist/modules/shop-members/shop-members.repository.js';
import { ShopMembersService } from '../dist/modules/shop-members/shop-members.service.js';
import { TenantResourcesService } from '../dist/modules/tenancy/tenant-resources.service.js';
import { TenantResourcesRepository } from '../dist/modules/tenancy/tenant-resources.repository.js';

const prisma = new PrismaService();
const rollback = new Error('Intentional add-on fixture rollback');
const email = `addons-check-${randomUUID()}@example.com`;
try {
  const tables = await prisma.$queryRaw`
    SELECT relname, relrowsecurity,
      has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
      has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated_access
    FROM pg_class WHERE oid IN ('public.add_ons'::regclass, 'public.product_add_ons'::regclass)`;
  assert.equal(tables.length, 2);
  for (const table of tables) {
    assert.equal(table.relrowsecurity, true);
    assert.equal(table.anon_access, false);
    assert.equal(table.authenticated_access, false);
  }
  const columns = await prisma.$queryRaw`
    SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'add_ons' AND column_name = 'priceAdjustment'`;
  assert.deepEqual(columns[0], {
    data_type: 'numeric',
    numeric_precision: 10,
    numeric_scale: 2,
  });
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused' },
        });
        const makeShop = () =>
          tx.shop.create({
            data: {
              name: 'Add-on fixture',
              slug: `addons-${randomUUID()}`,
              members: { create: { userId: user.id, role: 'OWNER' } },
            },
          });
        const shop = await makeShop(),
          otherShop = await makeShop();
        const category = await tx.category.create({
          data: { shopId: shop.id, name: 'Drinks', slug: 'drinks' },
        });
        const product = await tx.product.create({
          data: {
            shopId: shop.id,
            categoryId: category.id,
            name: 'Latte',
            slug: 'latte',
            price: '120.00',
          },
        });
        const food = await tx.product.create({
          data: {
            shopId: shop.id,
            name: 'Sandwich',
            slug: 'sandwich',
            price: '100.00',
          },
        });
        const foreignProduct = await tx.product.create({
          data: {
            shopId: otherShop.id,
            name: 'Foreign Latte',
            slug: 'latte',
            price: '50.00',
          },
        });
        const members = new ShopMembersService(new ShopMembersRepository(tx));
        const resources = new TenantResourcesService(
          members,
          new TenantResourcesRepository(tx),
        );
        const repo = new AddOnsRepository(tx);
        const service = new AddOnsService(repo, members, resources);
        const shot = (
          await service.createExtraShot(user.id, shop.id, {
            priceAdjustment: '30.1',
          })
        ).addOn;
        const oat = (
          await service.createOatMilk(user.id, shop.id, {
            priceAdjustment: '25.2',
          })
        ).addOn;
        const cheese = (
          await service.create(user.id, shop.id, {
            name: 'Cheese',
            priceAdjustment: '0',
          })
        ).addOn;
        const bacon = (
          await service.create(user.id, shop.id, {
            name: 'Bacon',
            priceAdjustment: '15',
          })
        ).addOn;
        const syrup = (
          await service.create(user.id, shop.id, {
            name: 'Syrup',
            priceAdjustment: '10',
            isAvailable: false,
          })
        ).addOn;
        const foreign = (
          await service.create(user.id, otherShop.id, {
            name: 'Extra Shot',
            priceAdjustment: '1',
          })
        ).addOn;
        assert.equal(shot.priceAdjustment, '30.10');
        assert.equal(shot.name, 'Extra Shot');
        assert.equal(shot.isAvailable, true);
        await assert.rejects(
          () =>
            service.createExtraShot(user.id, shop.id, { priceAdjustment: '0' }),
          (error) => error.getStatus() === 400,
        );
        assert.equal(oat.name, 'Oat Milk');
        assert.equal(oat.priceAdjustment, '25.20');
        assert.equal(oat.isAvailable, true);
        await assert.rejects(
          () =>
            service.createOatMilk(user.id, shop.id, { priceAdjustment: '0' }),
          (error) => error.getResponse().code === 'OAT_MILK_REQUIRES_SURCHARGE',
        );
        assert.equal(cheese.priceAdjustment, '0.00');
        assert.equal((await service.list(user.id, shop.id)).addOns.length, 5);
        for (const addOn of [shot, oat, syrup])
          await service.assign(user.id, shop.id, product.id, addOn.id);
        for (const addOn of [cheese, bacon])
          await service.assign(user.id, shop.id, food.id, addOn.id);
        await service.assign(
          user.id,
          otherShop.id,
          foreignProduct.id,
          foreign.id,
        );
        assert.equal(
          (await service.productList(user.id, shop.id, product.id)).addOns
            .length,
          3,
        );
        assert.equal(
          (await service.publicList(shop.slug, product.id)).addOns.length,
          2,
        );
        let quote = await service.quote(shop.slug, product.id, {
          addOnIds: [shot.id, oat.id],
        });
        assert.equal(quote.addOnTotal, '55.30');
        const catalogWithUsage = await service.list(user.id, shop.id);
        assert.deepEqual(
          catalogWithUsage.addOns.find((item) => item.id === oat.id)
            .assignedProducts,
          [{ id: product.id, name: product.name, isArchived: false }],
        );
        assert.equal(
          catalogWithUsage.addOns.some((item) => item.id === foreign.id),
          false,
        );
        assert.equal(quote.baseWithAddOnsPrice, '175.30');
        assert.equal(
          (await service.quote(shop.slug, product.id, { addOnIds: [oat.id] }))
            .baseWithAddOnsPrice,
          '145.20',
        );
        await assert.rejects(
          () => service.quote(shop.slug, food.id, { addOnIds: [oat.id] }),
          (error) => error.getResponse().code === 'ADD_ON_SELECTION_INVALID',
        );

        assert.equal(
          (await service.quote(shop.slug, product.id, { addOnIds: [shot.id] }))
            .baseWithAddOnsPrice,
          '150.10',
        );
        await assert.rejects(
          () => service.quote(shop.slug, food.id, { addOnIds: [shot.id] }),
          (error) => error.getResponse().code === 'ADD_ON_SELECTION_INVALID',
        );
        assert.equal(
          (await service.quote(shop.slug, product.id, { addOnIds: [] }))
            .baseWithAddOnsPrice,
          '120.00',
        );
        assert.equal(
          (await service.quote(shop.slug, food.id, { addOnIds: [cheese.id] }))
            .addOnTotal,
          '0.00',
        );
        for (const id of [cheese.id, foreign.id, syrup.id, randomUUID()]) {
          await assert.rejects(
            () => service.quote(shop.slug, product.id, { addOnIds: [id] }),
            (error) => error.getResponse().code === 'ADD_ON_SELECTION_INVALID',
          );
        }
        await assert.rejects(
          () =>
            service.quote(shop.slug, product.id, {
              addOnIds: [shot.id, shot.id],
            }),
          (error) => error.getStatus() === 400,
        );
        await assert.rejects(
          () => service.assign(user.id, shop.id, product.id, foreign.id),
          (error) => error.getStatus() === 404,
        );
        await assert.rejects(
          () =>
            resources.requireResource(user.id, shop.id, 'addOn', foreign.id),
          (error) => error.getStatus() === 404,
        );
        await assert.rejects(
          () => service.publicList(shop.slug, foreignProduct.id),
          (error) => error.getStatus() === 404,
        );
        await service.update(user.id, shop.id, shot.id, {
          priceAdjustment: '31.11',
        });
        await tx.product.update({
          where: { id: product.id },
          data: { price: '125.01' },
        });
        quote = await service.quote(shop.slug, product.id, {
          addOnIds: [shot.id, oat.id],
        });
        assert.equal(quote.basePrice, '125.01');
        assert.equal(quote.addOnTotal, '56.31');
        assert.equal(quote.baseWithAddOnsPrice, '181.32');
        await service.update(user.id, shop.id, oat.id, { isAvailable: false });
        await assert.rejects(
          () => service.quote(shop.slug, product.id, { addOnIds: [oat.id] }),
          (error) => error.getStatus() === 400,
        );
        await service.update(user.id, shop.id, oat.id, { isAvailable: true });
        await service.unassign(user.id, shop.id, product.id, oat.id);
        await assert.rejects(
          () => service.quote(shop.slug, product.id, { addOnIds: [oat.id] }),
          (error) => error.getStatus() === 400,
        );
        // Milk alternatives are owner data, with no schema-specific categories.
        for (const name of ['Soy Milk', 'Almond Milk', 'Coconut Milk']) {
          const alternative = (
            await service.create(user.id, shop.id, {
              name,
              priceAdjustment: '18.75',
            })
          ).addOn;
          await service.assign(user.id, shop.id, product.id, alternative.id);
          const alternativeQuote = await service.quote(shop.slug, product.id, {
            addOnIds: [alternative.id],
          });
          assert.equal(alternativeQuote.addOns[0].name, name);
          assert.equal(alternativeQuote.addOnTotal, '18.75');
          assert.equal(alternativeQuote.baseWithAddOnsPrice, '143.76');
        }
        // Custom toppings and free removal instructions share the same data model.
        const removal = (
          await service.create(user.id, shop.id, {
            name: 'No Onions',
            priceAdjustment: '0',
          })
        ).addOn;
        const topping = (
          await service.create(user.id, shop.id, {
            name: 'Extra Cheese',
            priceAdjustment: '15.50',
          })
        ).addOn;
        for (const modifier of [removal, topping])
          await service.assign(user.id, shop.id, food.id, modifier.id);
        const freeRemoval = await service.quote(shop.slug, food.id, {
          addOnIds: [removal.id],
        });
        assert.equal(freeRemoval.baseWithAddOnsPrice, '100.00');
        assert.equal(freeRemoval.addOnTotal, '0.00');
        assert.equal(freeRemoval.addOns[0].name, 'No Onions');
        assert.equal(freeRemoval.addOns[0].priceAdjustment, '0.00');
        const topped = await service.quote(shop.slug, food.id, {
          addOnIds: [removal.id, topping.id],
        });
        assert.equal(topped.baseWithAddOnsPrice, '115.50');
        assert.equal(topped.addOnTotal, '15.50');
        assert.equal(topped.addOns.length, 2);
        await assert.rejects(
          () =>
            service.quote(shop.slug, product.id, { addOnIds: [removal.id] }),
          (error) => error.getResponse().code === 'ADD_ON_SELECTION_INVALID',
        );
        await service.update(user.id, shop.id, topping.id, {
          priceAdjustment: '12.75',
        });
        assert.equal(
          (
            await service.quote(shop.slug, food.id, {
              addOnIds: [removal.id, topping.id],
            })
          ).baseWithAddOnsPrice,
          '112.75',
        );
        await service.update(user.id, shop.id, removal.id, {
          isAvailable: false,
        });
        await assert.rejects(
          () => service.quote(shop.slug, food.id, { addOnIds: [removal.id] }),
          (error) => error.getStatus() === 400,
        );
        await service.update(user.id, shop.id, removal.id, {
          isAvailable: true,
        });
        await service.unassign(user.id, shop.id, food.id, removal.id);
        await assert.rejects(
          () => service.quote(shop.slug, food.id, { addOnIds: [removal.id] }),
          (error) => error.getStatus() === 400,
        );
        const rejectedWrite = async (operation, predicate) => {
          await tx.$executeRawUnsafe('SAVEPOINT invalid_addon');
          await assert.rejects(operation, predicate);
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_addon');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_addon');
        };
        await rejectedWrite(
          () => service.assign(user.id, shop.id, product.id, shot.id),
          (error) => error.getStatus() === 409,
        );
        const sqlState = (error) =>
          error.meta?.code ??
          error.meta?.driverAdapterError?.cause?.originalCode;
        for (const price of ['-0.01', 'NaN', '100000000'])
          await rejectedWrite(
            () =>
              tx.$executeRaw`UPDATE add_ons SET "priceAdjustment" = ${price}::numeric WHERE id = ${shot.id}`,
            (error) => ['23514', '22003'].includes(sqlState(error)),
          );
        await rejectedWrite(
          () =>
            tx.productAddOn.create({
              data: {
                shopId: shop.id,
                productId: product.id,
                addOnId: foreign.id,
              },
            }),
          (error) => error.code === 'P2003',
        );
        await rejectedWrite(
          () =>
            tx.productAddOn.create({
              data: {
                shopId: shop.id,
                productId: foreignProduct.id,
                addOnId: cheese.id,
              },
            }),
          (error) => error.code === 'P2003',
        );
        await tx.category.update({
          where: { id: category.id },
          data: { isVisible: false },
        });
        await assert.rejects(
          () => service.quote(shop.slug, product.id, { addOnIds: [] }),
          (error) => error.getStatus() === 404,
        );
        await tx.category.update({
          where: { id: category.id },
          data: { isVisible: true },
        });
        for (const status of ['SOLD_OUT', 'HIDDEN']) {
          await tx.product.update({
            where: { id: product.id },
            data: { status },
          });
          await assert.rejects(
            () => service.quote(shop.slug, product.id, { addOnIds: [] }),
            (error) => error.getStatus() === 404,
          );
        }
        await tx.product.update({
          where: { id: product.id },
          data: { status: 'AVAILABLE', isArchived: true },
        });
        await assert.rejects(
          () => service.publicList(shop.slug, product.id),
          (error) => error.getStatus() === 404,
        );
        await tx.product.update({
          where: { id: product.id },
          data: { isArchived: false },
        });
        await tx.shop.update({
          where: { id: shop.id },
          data: { isActive: false },
        });
        await assert.rejects(
          () => service.publicList(shop.slug, product.id),
          (error) => error.getStatus() === 404,
        );
        await tx.shop.update({
          where: { id: shop.id },
          data: { isActive: true },
        });
        const deleteFixture = (
          await service.create(user.id, shop.id, {
            name: 'Delete fixture',
            priceAdjustment: '7.25',
          })
        ).addOn;
        await service.assign(user.id, shop.id, product.id, deleteFixture.id);
        await service.assign(user.id, shop.id, food.id, deleteFixture.id);
        assert.equal(
          await tx.productAddOn.count({
            where: { shopId: shop.id, addOnId: deleteFixture.id },
          }),
          2,
        );
        await assert.rejects(
          () => service.delete(user.id, shop.id, foreign.id),
          (error) => error.getStatus() === 404,
        );
        await tx.product.update({
          where: { id: food.id, shopId: shop.id },
          data: { isArchived: true },
        });
        await service.delete(user.id, shop.id, deleteFixture.id);
        assert.equal(
          await tx.productAddOn.count({
            where: { shopId: shop.id, addOnId: deleteFixture.id },
          }),
          0,
        );
        assert.equal(
          await tx.addOn.count({
            where: { id: deleteFixture.id, shopId: shop.id },
          }),
          0,
        );
        assert.equal(
          await tx.product.count({
            where: { shopId: shop.id, id: { in: [product.id, food.id] } },
          }),
          2,
        );
        await assert.rejects(
          () =>
            service.quote(shop.slug, product.id, {
              addOnIds: [deleteFixture.id],
            }),
          (error) => error.getStatus() === 400,
        );
        await tx.shopMember.update({
          where: { userId_shopId: { userId: user.id, shopId: shop.id } },
          data: { role: 'CASHIER' },
        });
        assert.equal(await repo.list(user.id, shop.id), null);
        await rejectedWrite(
          () => repo.delete(user.id, shop.id, shot.id),
          (error) => error.code === 'P2025',
        );
        await rejectedWrite(
          () => repo.update(user.id, shop.id, shot.id, { name: 'Changed' }),
          (error) => error.code === 'P2025',
        );
        // Product deletion removes eligibility; the reusable shop add-on remains.
        await tx.product.delete({ where: { id: product.id } });
        assert.equal(
          await tx.productAddOn.count({
            where: { shopId: shop.id, productId: product.id },
          }),
          0,
        );
        assert.equal(
          await tx.addOn.count({ where: { id: shot.id, shopId: shop.id } }),
          1,
        );
        throw rollback;
      },
      { timeout: 120000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  console.log(
    'Reusable add-ons, product eligibility, current exact backend quotes, invalid/disabled selections, cross-shop constraints, live roles, product visibility and RLS passed. Fixtures rolled back.',
  );
} finally {
  await prisma.$disconnect();
}
