import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../dist/database/prisma.service.js';
import { PublicMenuController } from '../dist/modules/categories/public-menu.controller.js';
import { PublicMenuRepository } from '../dist/modules/categories/public-menu.repository.js';
import { PublicProductRepository } from '../dist/modules/products/public-product.repository.js';
import { PublicProductService } from '../dist/modules/products/public-product.service.js';

// Only temporary fixtures are written. Every successful check deliberately rolls back.
const prisma = new PrismaService();
const email = `phase7-${randomUUID()}@example.com`;
const rollback = new Error('Intentional Phase 7 fixture rollback');
const shopSlugs = [];
const rejects = (status) => (error) => error.getStatus?.() === status;
try {
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash: 'unused' },
        });
        const makeShop = async () => {
          const slug = `phase7-${randomUUID()}`;
          shopSlugs.push(slug);
          return tx.shop.create({
            data: {
              name: 'Phase 7 fixture',
              slug,
              description: 'Public description',
              primaryColor: '#123456',
              accentColor: '#C9EF83',
              logoUrl: 'https://example.com/logo.webp',
              bannerUrl: 'https://example.com/banner.webp',
              members: { create: { userId: user.id, role: 'OWNER' } },
            },
          });
        };
        const shop = await makeShop();
        const other = await makeShop();
        const makeCategory = (name, sortOrder, isVisible = true) =>
          tx.category.create({
            data: {
              shopId: shop.id,
              name,
              slug: name.toLowerCase(),
              sortOrder,
              isVisible,
            },
          });
        const later = await makeCategory('Later', 2);
        const first = await makeCategory('First', 1);
        const hiddenCategory = await makeCategory('Hidden', 0, false);
        const makeProduct = (change = {}) =>
          tx.product.create({
            data: {
              shopId: shop.id,
              name: 'Coffee',
              slug: randomUUID(),
              price: '120.01',
              description: 'Fresh coffee',
              imageUrl: 'https://example.com/coffee.webp',
              categoryId: first.id,
              ...change,
            },
          });
        const product = await makeProduct({ isFeatured: true });
        const sold = await makeProduct({
          name: 'Sold',
          status: 'SOLD_OUT',
          categoryId: later.id,
        });
        await makeProduct({ status: 'HIDDEN' });
        await makeProduct({ isArchived: true });
        await makeProduct({ categoryId: hiddenCategory.id });
        const foreign = await makeProduct({
          shopId: other.id,
          categoryId: null,
          price: '10.02',
        });
        const menu = new PublicMenuController(new PublicMenuRepository(tx));
        const products = new PublicProductService(
          new PublicProductRepository(tx),
        );
        const readMenu = (slug = shop.slug) =>
          menu.read(slug, { setHeader() {} });
        for (const layout of ['grid', 'list', 'compact']) {
          await tx.shop.update({
            where: { id: shop.id },
            data: { menuLayout: layout },
          });
          const response = await readMenu();
          assert.equal(response.shop.menuLayout, layout);
          assert.equal(response.shop.primaryColor, '#123456');
          assert.equal(response.shop.accentColor, '#C9EF83');
          assert.equal(response.shop.logoUrl, 'https://example.com/logo.webp');
          assert.equal(
            response.shop.bannerUrl,
            'https://example.com/banner.webp',
          );
          assert.deepEqual(
            response.categories.map((item) => item.id),
            [first.id, later.id],
          );
          assert.deepEqual(
            new Set(response.products.map((item) => item.id)),
            new Set([product.id, sold.id]),
          );
          assert.deepEqual(
            response.featuredProducts.map((item) => item.id),
            [product.id],
          );
          assert.equal(
            response.products.find((item) => item.id === sold.id).isOrderable,
            false,
          );
          assert.equal(Object.hasOwn(response.shop, 'id'), false);
        }
        assert.equal((await readMenu(other.slug)).products[0].price, '10.02');
        await assert.rejects(
          products.details(shop.slug, foreign.id),
          rejects(404),
        );
        const group = await tx.productOptionGroup.create({
          data: {
            shopId: shop.id,
            productId: product.id,
            name: 'Size',
            isRequired: true,
          },
        });
        const disabledGroup = await tx.productOptionGroup.create({
          data: {
            shopId: shop.id,
            productId: product.id,
            name: 'Disabled group',
            isAvailable: false,
          },
        });
        const variant = (name, priceAdjustment, change = {}) =>
          tx.productVariant.create({
            data: {
              shopId: shop.id,
              productId: product.id,
              optionGroupId: group.id,
              name,
              priceAdjustment,
              ...change,
            },
          });
        const regular = await variant('Regular', '0.00', { isDefault: true });
        const large = await variant('Large', '30.10');
        await variant('Disabled', '20.00', { isAvailable: false });
        await variant('Hidden group choice', '5.00', {
          optionGroupId: disabledGroup.id,
        });
        const addOn = (name, priceAdjustment, change = {}) =>
          tx.addOn.create({
            data: {
              shopId: shop.id,
              name,
              priceAdjustment,
              ...change,
            },
          });
        const milk = await addOn('Oat milk', '25.20');
        const free = await addOn('No sugar', '0.00');
        const disabled = await addOn('Disabled extra', '2.00', {
          isAvailable: false,
        });
        const unassigned = await addOn('Unassigned extra', '3.00');
        for (const item of [milk, free, disabled])
          await tx.productAddOn.create({
            data: {
              shopId: shop.id,
              productId: product.id,
              addOnId: item.id,
            },
          });
        const details = await products.details(shop.slug, product.id);
        assert.equal(details.product.description, 'Fresh coffee');
        assert.equal(details.product.price, '120.01');
        assert.deepEqual(
          details.optionGroups.map((item) => item.id),
          [group.id],
        );
        assert.deepEqual(
          new Set(details.variants.map((item) => item.id)),
          new Set([regular.id, large.id]),
        );
        assert.deepEqual(
          new Set(details.addOns.map((item) => item.id)),
          new Set([milk.id, free.id]),
        );
        assert.equal(Object.hasOwn(details.product, 'shopId'), false);
        const selection = {
          variantIds: [large.id],
          addOnIds: [milk.id, free.id],
          quantity: 3,
        };
        const quote = await products.quote(shop.slug, product.id, selection);
        assert.equal(quote.unitPrice, '175.31');
        assert.equal(quote.totalPrice, '525.93');
        assert.deepEqual(
          quote.addOns.map((item) => item.id),
          [milk.id, free.id],
        );
        for (const id of [disabled.id, unassigned.id])
          await assert.rejects(
            products.quote(shop.slug, product.id, {
              ...selection,
              addOnIds: [id],
            }),
            rejects(400),
          );
        await assert.rejects(
          products.quote(shop.slug, product.id, {
            ...selection,
            variantIds: [],
          }),
          rejects(400),
        );
        await assert.rejects(
          products.quote(shop.slug, product.id, {
            ...selection,
            variantIds: [regular.id, large.id],
          }),
          rejects(400),
        );
        await tx.product.update({
          where: { id: product.id },
          data: { price: '125.01' },
        });
        assert.equal(
          (await products.quote(shop.slug, product.id, selection)).totalPrice,
          '540.93',
        );
        await tx.addOn.update({
          where: { id: milk.id },
          data: { isAvailable: false },
        });
        await assert.rejects(
          products.quote(shop.slug, product.id, selection),
          rejects(400),
        );
        await tx.addOn.update({
          where: { id: milk.id },
          data: { isAvailable: true },
        });
        await tx.productVariant.update({
          where: { id: large.id },
          data: { isAvailable: false },
        });
        await assert.rejects(
          products.quote(shop.slug, product.id, selection),
          rejects(400),
        );
        await tx.productVariant.update({
          where: { id: large.id },
          data: { isAvailable: true },
        });
        await tx.product.update({
          where: { id: product.id },
          data: { status: 'SOLD_OUT' },
        });
        assert.equal(
          (await products.details(shop.slug, product.id)).product.isOrderable,
          false,
        );
        await assert.rejects(
          products.quote(shop.slug, product.id, selection),
          rejects(404),
        );
        await tx.product.update({
          where: { id: product.id },
          data: { status: 'AVAILABLE' },
        });
        await tx.category.update({
          where: { id: first.id },
          data: { isVisible: false },
        });
        assert.equal(
          (await readMenu()).products.some((item) => item.id === product.id),
          false,
        );
        await assert.rejects(
          products.details(shop.slug, product.id),
          rejects(404),
        );
        await assert.rejects(
          products.quote(shop.slug, product.id, selection),
          rejects(404),
        );
        await tx.category.update({
          where: { id: first.id },
          data: { isVisible: true },
        });
        await tx.product.update({
          where: { id: product.id },
          data: { isArchived: true },
        });
        await assert.rejects(
          products.details(shop.slug, product.id),
          rejects(404),
        );
        await tx.shop.update({
          where: { id: shop.id },
          data: { isActive: false },
        });
        await assert.rejects(readMenu(), rejects(404));
        await assert.rejects(
          products.details(shop.slug, sold.id),
          rejects(404),
        );
        await assert.rejects(readMenu(`missing-${randomUUID()}`), rejects(404));
        throw rollback;
      },
      { timeout: 120000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  assert.equal(
    await prisma.shop.count({ where: { slug: { in: shopSlugs } } }),
    0,
  );
  console.log(
    'Phase 7 live database checks passed: branding/layouts, visible categories/products, tenant scope, public fields, variants/add-ons, exact current pricing, stale/sold-out/hidden/archive/inactive rejection. Fixtures rolled back and removed.',
  );
} finally {
  await prisma.$disconnect();
}
