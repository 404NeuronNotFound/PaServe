import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';

export type OrderWorkflow = 'cashier' | 'kitchen';
type Listener = (event: 'new_order' | 'resync' | 'unavailable') => void;
type Subscription = {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
  connected: boolean;
};

@Injectable()
export class NewOrderEventsService implements OnModuleDestroy {
  private client?: SupabaseClient;
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly streams = new Set<() => void>();
  private readonly removals = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly members: ShopMembersService,
  ) {}

  private requireAccess(
    userId: string,
    shopId: string,
    workflow: OrderWorkflow,
  ) {
    return this.members.requirePermission(
      userId,
      shopId,
      workflow === 'cashier'
        ? 'shop.orders.read'
        : 'shop.preparation.queue.read',
    );
  }

  /** Reuse one private Supabase subscription per shop/workflow per API process. */
  private async listen(
    shopId: string,
    workflow: OrderWorkflow,
    listener: Listener,
  ) {
    const topic = `staff:new-order:${shopId}:${workflow}`;
    // A rapid reconnect must not reuse a channel that is still leaving.
    await this.removals.get(topic);
    if (!this.client) {
      this.client = createClient(
        this.config.getOrThrow<string>('SUPABASE_URL'),
        this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
    }
    let entry = this.subscriptions.get(topic);
    if (!entry) {
      const listeners = new Set<Listener>();
      const channel = this.client.channel(topic, { config: { private: true } });
      const subscription = { channel, listeners, connected: false };
      entry = subscription;
      this.subscriptions.set(topic, entry);
      listeners.add(listener);
      channel
        .on('broadcast', { event: 'new_order' }, ({ payload }) => {
          const data = payload as Record<string, unknown> | null;
          if (data?.shopId === shopId && data.workflow === workflow)
            for (const notify of listeners) notify('new_order');
        })
        .subscribe((status) => {
          subscription.connected = status === 'SUBSCRIBED';
          const event = status === 'SUBSCRIBED' ? 'resync' : 'unavailable';
          for (const notify of listeners) notify(event);
        });
    } else {
      entry.listeners.add(listener);
      // Close the initial read/subscription race for additional local consumers.
      listener(entry.connected ? 'resync' : 'unavailable');
    }
    const subscription = entry;
    return () => {
      subscription.listeners.delete(listener);
      if (!subscription.listeners.size) {
        this.subscriptions.delete(topic);
        const removal = Promise.resolve(
          this.client?.removeChannel(subscription.channel),
        ).catch(() => undefined);
        this.removals.set(topic, removal);
        void removal.then(() => {
          if (this.removals.get(topic) === removal) this.removals.delete(topic);
        });
      }
    };
  }

  async stream(
    token: string,
    shopId: string,
    workflow: OrderWorkflow,
    response: Response,
  ) {
    const actor = await this.auth.currentUser(token);
    await this.requireAccess(actor.id, shopId, workflow);
    if (response.destroyed) return;
    let closed = false;
    let checking = false;
    let pending:
      'new_order' | 'resync' | 'unavailable' | 'heartbeat' | undefined;
    let unlisten: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(expiry);
      unlisten?.();
      this.streams.delete(close);
      response.end();
    };
    const deliver = async (event: NonNullable<typeof pending>) => {
      if (closed) return;
      if (checking) {
        // Coalesce bursts; the client fetches authoritative state, not deltas.
        if (event !== 'heartbeat') pending = event;
        return;
      }
      checking = true;
      try {
        const current = await this.auth.currentUser(token);
        await this.requireAccess(current.id, shopId, workflow);
        if (
          !closed &&
          !response.write(
            `event: ${event}\ndata: ${JSON.stringify({ shopId, workflow })}\n\n`,
          )
        )
          close();
      } catch {
        close();
      } finally {
        checking = false;
        const next = pending;
        pending = undefined;
        if (next) void deliver(next);
      }
    };
    response.on('close', close);
    this.streams.add(close);
    try {
      // Resolve configuration and subscribe before opening a successful stream.
      unlisten = await this.listen(shopId, workflow, (event) => {
        void deliver(event);
      });
      if (closed) {
        unlisten();
        return;
      }
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();
      heartbeat = setInterval(() => {
        void deliver('heartbeat');
      }, 15_000);
      // Bound connection lifetime. Reconnection uses the current browser token.
      expiry = setTimeout(close, 60_000);
    } catch (error) {
      if (response.headersSent) close();
      else {
        closed = true;
        this.streams.delete(close);
        response.off('close', close);
        unlisten?.();
      }
      throw error;
    }
  }

  async onModuleDestroy() {
    for (const close of this.streams) close();
    await this.client?.removeAllChannels();
    await this.client?.realtime.disconnect();
    this.subscriptions.clear();
  }
}
