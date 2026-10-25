import { createHash } from 'node:crypto';
import { Prisma, type ShopRole } from '../../src/generated/prisma/client.js';
import { copyPriceSnapshot } from '../../src/modules/orders/order-price-snapshots.js';
import { formatOrderNumber } from '../../src/modules/orders/order-number.js';
import { businesses, slugify, type Kind } from './catalog.js';

export const PASSWORD = 'PaServe123!';
export const ROLES: ShopRole[] = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'CASHIER',
  'CASHIER',
  'KITCHEN',
  'KITCHEN',
];
export function id(key: string) {
  const hex = createHash('sha256')
    .update(`paserve-demo-v1:${key}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export const money = (pesos: number) => new Prisma.Decimal(pesos).toFixed(2);
export type ImageEntry = {
  productId: string;
  productName: string;
  shopId: string;
  shop: string;
  category: string;
  kind: Kind;
  filename: string;
  storagePath: string;
  prompt: string;
  status: 'pending' | 'uploaded';
  fallbackUrl: string;
  imageUrl?: string;
};
const visualDetails = (name: string, kind: Kind) => {
  if (kind === 'coffee') {
    const iced = /Iced|Cold Brew/.test(name);
    return (
      `${iced ? 'clear tall glass with visible ice cubes' : 'matte ceramic cup'}, ${/Americano|Cold Brew|Pour Over|Brew/.test(name) ? 'dark black coffee with subtle crema' : 'espresso and creamy milk'}` +
      (/Cappuccino/.test(name) ? ', thick cappuccino microfoam' : '') +
      (/Caramel/.test(name)
        ? ', caramel drizzle and distinct espresso and milk layers'
        : '') +
      (/Spanish/.test(name) ? ', condensed milk and espresso layers' : '') +
      (/Mocha/.test(name) ? ', rich chocolate tones' : '') +
      (/Coconut/.test(name) ? ', coconut milk' : '') +
      (/Hazelnut/.test(name) ? ', hazelnut-infused milk' : '')
    );
  }
  if (/Matcha/.test(name))
    return 'natural green matcha and creamy milk, light foam in a clear glass';
  if (/Basque/.test(name))
    return 'one thick cheesecake slice, dark caramelized burnt top and creamy center, ceramic plate';
  if (kind === 'milk-tea')
    return `clear cup with ice, ${/Taro|Ube/.test(name) ? 'purple' : /Cocoa/.test(name) ? 'chocolate brown' : /Honeydew/.test(name) ? 'pale green' : /Thai/.test(name) ? 'orange amber' : 'creamy tea brown'} beverage, ${/Pearl|Brown Sugar|Classic/.test(name) ? 'visible tapioca pearls at the bottom' : 'smooth tea and milk'}, ${/Cream Cheese/.test(name) ? 'thick cream cheese foam cap' : 'subtle milk swirls'}`;
  if (kind === 'pastry')
    return `one freshly baked ${name.toLowerCase()} on a neutral bakery tray, golden baked crust, visible filling where appropriate, accurate flaky or soft bread texture`;
  if (kind === 'tea')
    return /Latte|Chocolate/.test(name)
      ? `ceramic cup of ${name.toLowerCase()}, creamy surface, delicate foam, accurate ingredient color`
      : `ceramic teacup of brewed ${name.toLowerCase()}, translucent tea, no milk`;
  if (kind === 'juice')
    return `clear glass of ${name.toLowerCase()}, ice, authentic fruit or tea color, matching fruit ingredients, no coffee`;
  if (kind === 'sandwich')
    return `${name.toLowerCase()} cut to show its named filling, toasted bread or burger bun as appropriate, simple ceramic plate`;
  if (kind === 'dessert')
    return `individual serving of ${name.toLowerCase()}, accurate named ingredients, visible interior texture, simple ceramic dessert plate`;
  return `freshly cooked ${name.toLowerCase()}, traditional preparation with its named core ingredients clearly visible, appropriate ceramic plate or bowl, appetizing texture`;
};
export function imagePrompt(name: string, kind: Kind) {
  return `Clean commercial restaurant menu product photography of ${name}: ${visualDetails(name, kind)}. Centered single serving, soft natural light, warm neutral background, realistic food photography, consistent square 1024 x 1024 composition, no people, no unrelated props, no text, no prices, no logo, no watermark.`;
}

export function buildPlan(now: Date, passwordHash: string, seed = 20261022) {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid seed date.');
  const rng = random(seed);
  const pick = <T>(values: readonly T[]) =>
    values[Math.floor(rng() * values.length)]!;
  const int = (min: number, max: number) =>
    min + Math.floor(rng() * (max - min + 1));
  // Use the same UTC+8 business day as sales analytics, independent of host timezone.
  const today = new Date(now.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const midnight = new Date(`${today}T00:00:00+08:00`).getTime();
  const started = new Date(midnight - 30 * 86400000);
  const manifest: ImageEntry[] = [];
  const shops = businesses.map((business, shopIndex) => {
    const shopId = id(business.slug);
    const shop = {
      id: shopId,
      name: business.name,
      slug: business.slug,
      displayName: business.name,
      description: `${business.concept}. Fictional PaServe demo business.`,
      address: `${21 + shopIndex * 12} Demo Lane, Quezon City, Philippines`,
      phone: `+63917000010${shopIndex}`,
      contactEmail: `hello@${business.slug}.example.test`,
      operatingHours:
        shopIndex === 2
          ? 'Daily 11:00-21:00'
          : shopIndex === 4
            ? 'Daily 11:00-20:00'
            : 'Daily 07:00-19:00',
      primaryColor: business.color,
      accentColor: business.accent,
      logoUrl: `/demo-assets/${business.slug}-logo.svg`,
      bannerUrl: `/demo-assets/${business.slug}-banner.svg`,
      menuLayout: (['grid', 'list', 'compact', 'grid', 'grid'] as const)[
        shopIndex
      ]!,
      isActive: true,
      acceptingOrders: true,
      createdAt: started,
      updatedAt: started,
      lastOrderNumber: 0n,
    };
    const firstNames = [
      'Maya',
      'Rafael',
      'Lia',
      'Paolo',
      'Bea',
      'Nico',
      'Clara',
    ];
    const surnames = ['Reyes', 'Santos', 'Navarro', 'Dizon', 'Mercado'];
    const users = ROLES.map((role, n) => ({
      id: id(`${business.slug}:user:${n}`),
      email: `${role.toLowerCase()}${n + 1}@${business.slug}.example.test`,
      passwordHash,
      firstName: firstNames[(n + shopIndex) % firstNames.length]!,
      lastName: surnames[shopIndex]!,
      isActive: true,
      createdAt: started,
      updatedAt: started,
    }));
    const members = users.map((user, n) => ({
      id: id(`${business.slug}:member:${n}`),
      userId: user.id,
      shopId,
      role: ROLES[n]!,
      createdAt: started,
      updatedAt: started,
    }));
    const tables = Array.from({ length: business.tables }, (_, n) => ({
      id: id(`${business.slug}:table:${n}`),
      shopId,
      number: `T${String(n + 1).padStart(2, '0')}`,
      code: `t_${createHash('sha256').update(`${business.slug}:table:${n}`).digest('hex').slice(0, 32)}`,
      isActive: true,
      createdAt: started,
      updatedAt: started,
    }));
    const categories = business.menu.map(([name], n) => ({
      id: id(`${business.slug}:category:${n}`),
      shopId,
      name,
      slug: slugify(name),
      description: `${name} at ${business.name}`,
      sortOrder: n,
      isVisible: true,
      createdAt: started,
      updatedAt: started,
    }));
    const products: Prisma.ProductCreateManyInput[] = [];
    const groups: Prisma.ProductOptionGroupCreateManyInput[] = [];
    const variants: Prisma.ProductVariantCreateManyInput[] = [];
    const addOns = [
      ['Extra Espresso Shot', 35],
      ['Oat Milk', 30],
      ['Soy Milk', 25],
      ['Vanilla Syrup', 20],
      ['Caramel Syrup', 20],
      ['Whipped Cream', 15],
      ['Pearls', 20],
      ['Coffee Jelly', 20],
      ['Nata', 15],
      ['Pudding', 25],
      ['Cream Cheese', 30],
      ['Extra Cheese', 25],
      ['Extra Patty', 65],
      ['Bacon', 40],
      ['Extra Rice', 30],
    ].map(([name, price], n) => ({
      id: id(`${business.slug}:addon:${n}`),
      shopId,
      name: String(name),
      priceAdjustment: money(Number(price)),
      isAvailable: true,
      sortOrder: n,
      createdAt: started,
      updatedAt: started,
    }));
    const links: Prisma.ProductAddOnCreateManyInput[] = [];
    const menu = business.menu.flatMap(([categoryName, rawKind, encoded], c) =>
      encoded.split('|').map((entry, p) => {
        const [name, rawPrice] = entry.split(':') as [string, string];
        const kind: Kind = rawKind;
        const productId = id(`${business.slug}:product:${c}:${p}`);
        const index = c * 5 + p;
        const price = Number(rawPrice);
        const featured = [0, 3, 5, 15].includes(index);
        const status =
          index % 20 === 19
            ? 'HIDDEN'
            : index % 13 === 12
              ? 'SOLD_OUT'
              : 'AVAILABLE';
        const fallbackUrl = `/demo-assets/${kind}.svg`;
        products.push({
          id: productId,
          shopId,
          categoryId: categories[c]!.id,
          name,
          slug: slugify(name),
          description: `${name}, freshly prepared to order. ${business.concept}.`,
          price: money(price),
          imageUrl: fallbackUrl,
          status,
          isFeatured: featured,
          isArchived: false,
          sortOrder: p,
          featuredSortOrder: featured ? index : 2147483647,
          createdAt: started,
          updatedAt: started,
        });
        manifest.push({
          productId,
          productName: name,
          shopId,
          shop: business.name,
          category: categoryName,
          kind,
          filename: `${slugify(name)}.webp`,
          storagePath: `shops/${shopId}/products/${productId}/${id(`${productId}:image`)}.webp`,
          prompt: imagePrompt(name, kind),
          status: 'pending',
          fallbackUrl,
        });
        const choices: Array<
          Array<{
            id: string;
            name: string;
            optionGroupId: string;
            isDefault: boolean;
            priceAdjustment: string;
          }>
        > = [];
        if (['coffee', 'tea', 'milk-tea', 'juice'].includes(kind)) {
          const addGroup = (
            groupName: string,
            options: Array<[string, number]>,
          ) => {
            const groupId = id(`${productId}:${groupName}`);
            groups.push({
              id: groupId,
              shopId,
              productId,
              name: groupName,
              isRequired: true,
              sortOrder: choices.length,
              createdAt: started,
              updatedAt: started,
            });
            const optionsForGroup = options.map(
              ([optionName, adjustment], v) => ({
                id: id(`${groupId}:${v}`),
                name: optionName,
                optionGroupId: groupId,
                isDefault: v === 0,
                priceAdjustment: money(adjustment),
              }),
            );
            variants.push(
              ...optionsForGroup.map((v, n) => ({
                ...v,
                shopId,
                productId,
                sortOrder: n,
                createdAt: started,
                updatedAt: started,
              })),
            );
            choices.push(optionsForGroup);
          };
          addGroup('Size', [
            ['Regular', 0],
            ['Large', 30],
          ]);
          if (kind === 'coffee' || kind === 'tea')
            addGroup(
              'Temperature',
              /Iced|Cold Brew/.test(name)
                ? [['Iced', 0]]
                : /Pour Over|Barako|Tea$|Hot Chocolate/.test(name)
                  ? [['Hot', 0]]
                  : [
                      ['Hot', 0],
                      ['Iced', 10],
                    ],
            );
          if (kind === 'milk-tea')
            addGroup('Sugar', [
              ['Regular Sugar', 0],
              ['Half Sugar', 0],
              ['No Added Sugar', 0],
            ]);
        }
        const allowed = addOns.filter((a) => {
          if (kind === 'coffee')
            return (
              a.name === 'Extra Espresso Shot' ||
              (/Latte|Mocha|Cappuccino|Macchiato/.test(name) &&
                [
                  'Oat Milk',
                  'Soy Milk',
                  'Vanilla Syrup',
                  'Caramel Syrup',
                  'Whipped Cream',
                ].includes(a.name))
            );
          if (kind === 'milk-tea')
            return [
              'Pearls',
              'Coffee Jelly',
              'Nata',
              'Pudding',
              'Cream Cheese',
            ].includes(a.name);
          if (kind === 'tea')
            return (
              /Latte|Chocolate/.test(name) &&
              ['Oat Milk', 'Soy Milk'].includes(a.name)
            );
          if (kind === 'sandwich')
            return (
              ['Extra Cheese', 'Bacon'].includes(a.name) ||
              (/Burger/.test(name) && a.name === 'Extra Patty')
            );
          return (
            kind === 'meal' &&
            /Rice|Silog|Adobo|Inasal|Liempo|Kare|Sinigang|Caldereta|Binagoongan|Express|Tinola|Curry|Afritada|Bangus|Tilapia/.test(
              name,
            ) &&
            a.name === 'Extra Rice'
          );
        });
        links.push(
          ...allowed.map((a) => ({ shopId, productId, addOnId: a.id })),
        );
        return {
          id: productId,
          name,
          price,
          featured,
          status,
          choices,
          allowed,
        };
      }),
    );
    // Featured menu entries have eight times the selection weight of long-tail items.
    const weighted = menu.flatMap((p) =>
      Array.from({ length: p.featured ? 8 : 1 }, () => p),
    );
    const liveMenu = weighted.filter((p) => p.status === 'AVAILABLE');
    const orders: Prisma.OrderCreateManyInput[] = [];
    const items: Prisma.OrderItemCreateManyInput[] = [];
    const timelines: Array<{
      id: string;
      target: string;
      startedAt: Date;
      readyAt: Date;
      completedAt: Date;
      kitchen: string;
      cashier: string;
    }> = [];
    const addOrder = (createdAt: Date, target: string) => {
      const sequence = orders.length + 1;
      const orderId = id(`${business.slug}:order:${seed}:${sequence}`);
      const cashier = pick(users.slice(3, 5)).id;
      const kitchen = pick(users.slice(5, 7)).id;
      const dine = rng() < business.dineIn;
      const table = dine ? pick(tables) : null;
      const lineCount = rng() < 0.65 ? int(1, 2) : rng() < 0.85 ? int(3, 4) : 5;
      const selected = Array.from({ length: lineCount }, () => {
        const product = pick(
          target === 'COMPLETED' || target === 'REJECTED' ? weighted : liveMenu,
        );
        const selectedVariants = product.choices.map((options) =>
          rng() < 0.7 ? options[0]! : pick(options),
        );
        const selectedAddOns =
          product.allowed.length && rng() < 0.3 ? [pick(product.allowed)] : [];
        const quantity = rng() < 0.85 ? 1 : int(2, 3);
        const unitPrice = selectedVariants
          .reduce(
            (sum, v) => sum.plus(v.priceAdjustment),
            new Prisma.Decimal(product.price),
          )
          .plus(
            selectedAddOns.reduce(
              (sum, a) => sum.plus(a.priceAdjustment),
              new Prisma.Decimal(0),
            ),
          );
        return copyPriceSnapshot({
          productId: product.id,
          productName: product.name,
          currency: 'PHP',
          basePrice: money(product.price),
          unitPrice: unitPrice.toFixed(2),
          totalPrice: unitPrice.times(quantity).toFixed(2),
          quantity,
          variants: selectedVariants,
          addOns: selectedAddOns.map(
            ({ id: addOnId, name, priceAdjustment }) => ({
              id: addOnId,
              name,
              priceAdjustment,
            }),
          ),
        });
      });
      const total = selected.reduce(
        (sum, line) => sum.plus(line.totalPrice),
        new Prisma.Decimal(0),
      );
      const paid = target !== 'REJECTED';
      const methodRoll = rng();
      const paymentMethod =
        methodRoll < 0.45
          ? 'CASH'
          : methodRoll < 0.85
            ? 'GCASH_MANUAL'
            : methodRoll < 0.95
              ? 'CARD_MANUAL'
              : 'OTHER';
      const received =
        paymentMethod === 'CASH' ? total.div(100).ceil().times(100) : total;
      const paidAt = new Date(createdAt.getTime() + int(1, 3) * 60000);
      const queuedAt = new Date(paidAt.getTime() + 1000);
      const startedAt = new Date(queuedAt.getTime() + int(1, 4) * 60000);
      const readyAt = new Date(
        startedAt.getTime() +
          int(shopIndex === 2 ? 8 : 3, shopIndex === 2 ? 20 : 10) * 60000,
      );
      const completedAt = new Date(readyAt.getTime() + int(1, 5) * 60000);
      const json = selected as unknown as Prisma.InputJsonValue;
      orders.push({
        id: orderId,
        shopId,
        tableId: table?.id ?? null,
        tableCode: table?.code ?? null,
        tableNumber: table?.number ?? null,
        mode: dine ? 'DINE_IN' : 'TAKEOUT',
        serviceType: dine ? 'TABLE_SERVICE' as const : null,
        requestId: id(`${orderId}:request`),
        requestHash: createHash('sha256')
          .update(JSON.stringify(selected))
          .digest('hex'),
        orderNumber: formatOrderNumber(BigInt(sequence)),
        qrTokenNonce: id(`${orderId}:token`),
        qrTokenExpiresAt: new Date(createdAt.getTime() + 7 * 86400000),
        qrTokenRevokedAt: paidAt,
        status: paid ? 'CONFIRMED' : 'REJECTED',
        decidedAt: paidAt,
        decidedBy: cashier,
        rejectionReason: paid
          ? null
          : 'Guest requested cancellation before payment',
        paymentStatus: paid ? 'PAID' : 'UNPAID',
        paymentMethod: paid ? paymentMethod : null,
        paymentRequestId: paid ? id(`${orderId}:payment`) : null,
        paymentReviewVersion: paid
          ? createHash('sha256').update(`${orderId}:review`).digest('hex')
          : null,
        paymentReference:
          paid && paymentMethod !== 'CASH'
            ? `DEMO-${shopIndex}-${sequence}`
            : null,
        paymentDescription:
          paid && paymentMethod === 'OTHER' ? 'Demo bank transfer' : null,
        amountReceived: paid ? received.toFixed(2) : null,
        changeDue: paid ? received.minus(total).toFixed(2) : null,
        paidAt: paid ? paidAt : null,
        paidBy: paid ? cashier : null,
        preparationStatus: paid ? 'QUEUED' : null,
        queuedAt: paid ? queuedAt : null,
        currency: 'PHP',
        totalPrice: total.toFixed(2),
        items: json,
        shopDetailsSnapshot: {
          name: shop.name,
          address: shop.address,
          phone: shop.phone,
          contactEmail: shop.contactEmail,
          website: null,
        },
        createdAt,
        updatedAt: paid ? queuedAt : paidAt,
      });
      selected.forEach((line, n) =>
        items.push({
          id: id(`${orderId}:line:${n}`),
          shopId,
          orderId,
          productId: line.productId,
          lineNumber: n + 1,
          quantity: line.quantity,
          snapshot: line as unknown as Prisma.InputJsonValue,
          productSnapshotId: line.productId,
          productNameSnapshot: line.productName,
          currency: 'PHP',
          basePriceSnapshot: line.basePrice,
          unitPriceSnapshot: line.unitPrice,
          lineTotalSnapshot: line.totalPrice,
          variantsSnapshot: line.variants as unknown as Prisma.InputJsonValue,
          addOnsSnapshot: line.addOns as unknown as Prisma.InputJsonValue,
          createdAt,
        }),
      );
      if (paid)
        timelines.push({
          id: orderId,
          target,
          startedAt,
          readyAt,
          completedAt,
          kitchen,
          cashier,
        });
    };
    for (let day = 0; day <= 30; day++) {
      const date = new Date(started.getTime() + day * 86400000);
      const weekend = [0, 6].includes(
        new Date(date.getTime() + 8 * 3600000).getUTCDay(),
      );
      const volume = Math.round(
        business.daily *
          (0.75 + rng() * 0.5) *
          (weekend ? (shopIndex === 1 ? 1.4 : 1.12) : 1),
      );
      const times = Array.from(
        { length: volume },
        () =>
          new Date(
            date.getTime() + (pick(business.peaks) * 60 + int(0, 59)) * 60000,
          ),
      ).sort((a, b) => a.getTime() - b.getTime());
      for (const time of times) {
        // Leave an hour for all completed transitions; never seed future transactions.
        if (time.getTime() > now.getTime() - 3600000) continue;
        addOrder(time, rng() < 0.94 ? 'COMPLETED' : 'REJECTED');
      }
    }
    for (const [target, count, minutesAgo] of [
      ['QUEUED', 3, 7],
      ['PREPARING', 2, 20],
      ['READY', 2, 35],
    ] as const) {
      for (let n = 0; n < count; n++)
        addOrder(new Date(now.getTime() - (minutesAgo + n) * 60000), target);
    }
    shop.lastOrderNumber = BigInt(orders.length);
    return {
      shop,
      users,
      members,
      tables,
      categories,
      products,
      groups,
      variants,
      addOns: addOns.filter((a) => links.some((l) => l.addOnId === a.id)),
      links,
      orders,
      items,
      timelines,
    };
  });
  return {
    seed,
    now: now.toISOString(),
    started: started.toISOString(),
    shops,
    manifest,
  };
}
export type DemoPlan = ReturnType<typeof buildPlan>;
