import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { PrismaService } from '../src/database/prisma.service.js';

// Opt-in live integration check. Creates two inactive fixture shops and removes
// only those fixtures afterward. Never uses the service-role key in a browser.
describe('Supabase Realtime foundation (live)', () => {
  let prisma: PrismaService;
  let admin: SupabaseClient;
  let browserClient: SupabaseClient;
  const shopA = randomUUID();
  const shopB = randomUUID();
  const productA = randomUUID();
  const productB = randomUUID();

  beforeAll(async () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const webEnv = parse(readFileSync('../web/.env'));
    if (!url || !key || !webEnv.VITE_SUPABASE_ANON_KEY) {
      throw new Error(
        'Configure backend Supabase URL/key and frontend anon key',
      );
    }
    expect(webEnv.VITE_SUPABASE_URL).toBe(url);
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    admin = createClient(url, key, options);
    browserClient = createClient(url, webEnv.VITE_SUPABASE_ANON_KEY, options);
    await admin.realtime.setAuth(key);
    prisma = new PrismaService();

    await prisma.$transaction(async (tx) => {
      for (const [shopId, productId] of [
        [shopA, productA],
        [shopB, productB],
      ]) {
        await tx.shop.create({
          data: {
            id: shopId,
            name: 'Realtime integration fixture',
            slug: `realtime-check-${shopId}`,
            isActive: false,
          },
        });
        await tx.product.create({
          data: {
            id: productId,
            shopId,
            name: 'Realtime fixture',
            slug: 'realtime-fixture',
            price: 1,
          },
        });
      }
    });
  }, 30_000);

  afterAll(async () => {
    await Promise.all([
      admin?.removeAllChannels(),
      browserClient?.removeAllChannels(),
    ]);
    await Promise.all([
      admin?.realtime.disconnect(),
      browserClient?.realtime.disconnect(),
    ]);
    if (prisma) {
      try {
        await prisma.shop.deleteMany({
          where: {
            id: { in: [shopA, shopB] },
            slug: { startsWith: 'realtime-check-' },
          },
        });
      } finally {
        await prisma.$disconnect();
      }
    }
  }, 30_000);

  it('publishes product changes with RLS enabled and browser privileges closed', async () => {
    const config = await prisma.$queryRaw<
      Array<{
        published: boolean;
        rls: boolean;
        anon_read: boolean;
        authenticated_read: boolean;
      }>
    >`
      SELECT
        EXISTS (SELECT 1 FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
            AND tablename = 'products') AS published,
        relrowsecurity AS rls,
        has_table_privilege('anon', 'public.products', 'SELECT') AS anon_read,
        has_table_privilege('authenticated', 'public.products', 'SELECT') AS authenticated_read
      FROM pg_class WHERE oid = 'public.products'::regclass
    `;
    expect(config).toEqual([
      {
        published: true,
        rls: true,
        anon_read: false,
        authenticated_read: false,
      },
    ]);

    const { data, error } = await browserClient
      .from('products')
      .select('id')
      .eq('id', productA);
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
    expect(data).toBeNull();
  }, 20_000);

  it('receives committed updates for the filtered shop, excluding another shop', async () => {
    const received: Array<Record<string, unknown>> = [];
    let resolveUpdate: () => void = () => {};
    let rejectUpdate: (reason: Error) => void = () => {};
    const update = new Promise<void>((resolve, reject) => {
      resolveUpdate = resolve;
      rejectUpdate = reject;
    });
    const channel = admin.channel(`foundation:${shopA}`).on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'products',
        filter: `shopId=eq.${shopA}`,
      },
      (payload) => {
        received.push(payload.new);
        if (payload.new.id === productA && payload.new.status === 'SOLD_OUT')
          resolveUpdate();
      },
    );

    await subscribe(channel);
    const timeout = setTimeout(
      () =>
        rejectUpdate(new Error('No product update received within 20 seconds')),
      20_000,
    );
    try {
      // Commit B before A so A acts as a delivery marker after the excluded event.
      await prisma.product.update({
        where: { id: productB, shopId: shopB },
        data: { status: 'SOLD_OUT' },
      });
      await prisma.product.update({
        where: { id: productA, shopId: shopA },
        data: { status: 'SOLD_OUT' },
      });
      await update;
      expect(received.length).toBeGreaterThan(0);
      expect(
        received.every((row) => row.shopId === shopA && row.id === productA),
      ).toBe(true);
    } finally {
      clearTimeout(timeout);
      await admin.removeChannel(channel);
    }
  }, 45_000);
});

function subscribe(channel: RealtimeChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Realtime connection timed out')),
      15_000,
    );
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve();
      } else if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        status === 'CLOSED'
      ) {
        clearTimeout(timeout);
        reject(new Error(`Realtime subscription failed: ${status}`));
      }
    });
  });
}
