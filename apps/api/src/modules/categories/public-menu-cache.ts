import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export function publicMenuCachePolicy(config: Record<string, unknown>) {
  const integer = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const value = Number(config[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} must be an integer from ${min} to ${max}`);
    return value;
  };
  const enabled = config.PUBLIC_MENU_CACHE_ENABLED;
  if (
    enabled !== undefined &&
    ![true, false, 'true', 'false'].includes(enabled as boolean | string)
  )
    throw new Error('PUBLIC_MENU_CACHE_ENABLED must be true or false');
  const maxBytes = integer(
    'PUBLIC_MENU_CACHE_MAX_BYTES',
    8 * 1024 * 1024,
    1024,
    64 * 1024 * 1024,
  );
  return {
    enabled: enabled !== false && enabled !== 'false',
    ttlMs: integer('PUBLIC_MENU_CACHE_TTL_MS', 15000, 100, 30000),
    maxEntries: integer('PUBLIC_MENU_CACHE_MAX_ENTRIES', 128, 1, 1000),
    maxBytes,
    maxEntryBytes: integer(
      'PUBLIC_MENU_CACHE_MAX_ENTRY_BYTES',
      Math.min(512 * 1024, maxBytes),
      128,
      maxBytes,
    ),
    maxInFlight: integer('PUBLIC_MENU_CACHE_MAX_IN_FLIGHT', 16, 1, 128),
  };
}

/** Immutable serialized public catalog pages only; no headers, proofs or users. */
@Injectable()
export class PublicMenuCache implements OnModuleDestroy {
  private readonly policy: ReturnType<typeof publicMenuCachePolicy>;
  private readonly entries = new Map<
    string,
    { body: string; bytes: number; expiresAt: number }
  >();
  private readonly pending = new Map<string, Promise<string>>();
  private bytes = 0;
  private stopped = false;
  private generation = 0;
  private readonly counts = {
    hits: 0,
    misses: 0,
    coalesced: 0,
    evictions: 0,
    expired: 0,
    oversized: 0,
    bypassed: 0,
    loadErrors: 0,
  };
  constructor(config: ConfigService) {
    const names = [
      'PUBLIC_MENU_CACHE_ENABLED',
      'PUBLIC_MENU_CACHE_TTL_MS',
      'PUBLIC_MENU_CACHE_MAX_ENTRIES',
      'PUBLIC_MENU_CACHE_MAX_BYTES',
      'PUBLIC_MENU_CACHE_MAX_ENTRY_BYTES',
      'PUBLIC_MENU_CACHE_MAX_IN_FLIGHT',
    ];
    this.policy = publicMenuCachePolicy(
      Object.fromEntries(names.map((name) => [name, config.get(name)])),
    );
  }
  get enabled() {
    return this.policy.enabled && !this.stopped;
  }
  snapshot() {
    return {
      ...this.counts,
      entries: this.entries.size,
      bytes: this.bytes,
      inFlight: this.pending.size,
    };
  }
  clear() {
    this.generation++;
    this.entries.clear();
    this.bytes = 0;
  }
  onModuleDestroy() {
    this.stopped = true;
    this.clear();
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
  async getOrLoad(key: string, load: () => Promise<string>): Promise<string> {
    if (!this.enabled) {
      this.counts.bypassed++;
      return load();
    }
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      this.counts.hits++;
      return entry.body;
    }
    if (entry) {
      this.remove(key);
      this.counts.expired++;
    }
    const existing = this.pending.get(key);
    if (existing) {
      this.counts.coalesced++;
      return existing;
    }
    if (this.pending.size >= this.policy.maxInFlight) {
      this.counts.bypassed++;
      return load();
    }
    this.counts.misses++;
    const generation = this.generation;
    // Defer the loader so even a synchronous throw removes its pending entry.
    const work = Promise.resolve()
      .then(load)
      .then(
        (body) => {
          const bytes = Buffer.byteLength(key) + Buffer.byteLength(body);
          if (bytes > this.policy.maxEntryBytes) {
            this.counts.oversized++;
            return body;
          }
          if (!this.enabled || generation !== this.generation) return body;
          while (
            this.entries.size >= this.policy.maxEntries ||
            this.bytes + bytes > this.policy.maxBytes
          ) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.remove(oldest);
            this.counts.evictions++;
          }
          this.entries.set(key, {
            body,
            bytes,
            expiresAt: Date.now() + this.policy.ttlMs,
          });
          this.bytes += bytes;
          return body;
        },
        (error) => {
          this.counts.loadErrors++;
          throw error;
        },
      )
      .finally(() => {
        if (this.pending.get(key) === work) this.pending.delete(key);
      });
    this.pending.set(key, work);
    return work;
  }
}
