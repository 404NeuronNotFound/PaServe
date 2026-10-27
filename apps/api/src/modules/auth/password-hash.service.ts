import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { argon2id, hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PasswordCapacityException } from '../../common/http/password-capacity.exception.js';

// Pin the already-used node-argon2 policy; do not weaken it for a load test.
export const PASSWORD_HASH_POLICY = Object.freeze({
  type: argon2id,
  version: 0x13,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
  hashLength: 32,
});

@Injectable()
export class PasswordHashService implements OnModuleInit {
  private active = 0;
  private reservedKiB = 0;
  private dummy?: Promise<string>;
  readonly maxConcurrent: number;
  readonly memoryBudgetKiB: number;
  private readonly counts = {
    started: 0,
    completed: 0,
    failed: 0,
    rejected: 0,
    invalidDigests: 0,
    hashJobs: 0,
    verifyJobs: 0,
    peakActive: 0,
    peakReservedKiB: 0,
    totalHashMs: 0,
    totalVerifyMs: 0,
  };

  constructor(config: ConfigService) {
    // This reports/checks the startup setting, not a measurement of libuv's pool.
    // Operators must set UV_THREADPOOL_SIZE before starting Node, never in .env.
    const poolSize = this.integer(
      process.env.UV_THREADPOOL_SIZE ?? 4,
      'UV_THREADPOOL_SIZE',
      2,
      1024,
    );
    this.maxConcurrent = this.integer(
      config.get<string>('AUTH_HASH_MAX_CONCURRENT') ??
        Math.min(2, poolSize - 1),
      'AUTH_HASH_MAX_CONCURRENT',
      1,
      Math.min(8, poolSize - 1),
    );
    this.memoryBudgetKiB =
      this.integer(
        config.get<string>('AUTH_HASH_MEMORY_MB') ?? 128,
        'AUTH_HASH_MEMORY_MB',
        64,
        512,
      ) * 1024;
  }

  private integer(
    value: string | number,
    name: string,
    min: number,
    max: number,
  ) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max)
      throw new Error(`${name} must be an integer between ${min} and ${max}`);
    return parsed;
  }

  async onModuleInit() {
    await this.dummyHash();
  }

  dummyHash(): Promise<string> {
    if (!this.dummy) {
      this.dummy = this.hash(randomBytes(32).toString('hex')).catch(
        (error: unknown) => {
          this.dummy = undefined;
          throw error;
        },
      );
    }
    return this.dummy;
  }

  private async run<T>(
    kind: 'hash' | 'verify',
    memoryKiB: number,
    work: () => Promise<T>,
  ): Promise<T> {
    if (
      this.active >= this.maxConcurrent ||
      this.reservedKiB + memoryKiB > this.memoryBudgetKiB
    ) {
      this.counts.rejected += 1;
      throw new PasswordCapacityException();
    }
    this.active += 1;
    this.reservedKiB += memoryKiB;
    this.counts.started += 1;
    this.counts[kind === 'hash' ? 'hashJobs' : 'verifyJobs'] += 1;
    this.counts.peakActive = Math.max(this.counts.peakActive, this.active);
    this.counts.peakReservedKiB = Math.max(
      this.counts.peakReservedKiB,
      this.reservedKiB,
    );
    const started = performance.now();
    try {
      const result = await work();
      this.counts.completed += 1;
      return result;
    } catch (error) {
      this.counts.failed += 1;
      throw error;
    } finally {
      // Native Argon2 cannot be cancelled by an HTTP disconnect/timeout. Never
      // release this reservation until its promise actually settles.
      this.active -= 1;
      this.reservedKiB -= memoryKiB;
      this.counts[kind === 'hash' ? 'totalHashMs' : 'totalVerifyMs'] +=
        performance.now() - started;
    }
  }

  hash(password: string): Promise<string> {
    return this.run('hash', PASSWORD_HASH_POLICY.memoryCost, () =>
      hash(password, PASSWORD_HASH_POLICY),
    );
  }

  private digestMemory(digest: string): number | undefined {
    if (typeof digest !== 'string' || digest.length > 512) return;
    // Bound stored PHC parameters before passing them to the native addon. Current
    // 64-MiB hashes remain valid; this also admits bounded existing Argon2id costs.
    const match =
      /^\$argon2id\$v=19\$([^$]{1,96})\$([A-Za-z0-9+/]{16,86})\$([A-Za-z0-9+/]{16,86})$/u.exec(
        digest,
      );
    if (!match) return;
    for (const encoded of [match[2], match[3]]) {
      if (
        Buffer.from(encoded, 'base64')
          .toString('base64')
          .replace(/=+$/u, '') !== encoded
      )
        return;
    }
    const parameters = new Map<string, number>();
    for (const part of match[1].split(',')) {
      const entry = /^(m|t|p)=(\d{1,6})$/u.exec(part);
      if (!entry || parameters.has(entry[1])) return;
      parameters.set(entry[1], Number(entry[2]));
    }
    if (parameters.size !== 3) return;
    const memory = parameters.get('m')!;
    const time = parameters.get('t')!;
    const lanes = parameters.get('p')!;
    if (
      memory < 8 * lanes ||
      memory > 131_072 ||
      time < 1 ||
      time > 6 ||
      lanes < 1 ||
      lanes > 4
    )
      return;
    return memory;
  }

  async verify(digest: string, password: string): Promise<boolean> {
    const memory = this.digestMemory(digest);
    if (memory === undefined) {
      this.counts.invalidDigests += 1;
      // Invalid/out-of-policy records must not create a cheap account-existence
      // oracle or trigger unbounded native allocation. No digest is logged.
      const dummy = await this.dummyHash();
      await this.run('verify', PASSWORD_HASH_POLICY.memoryCost, () =>
        verify(dummy, password),
      );
      return false;
    }
    return this.run('verify', memory, () => verify(digest, password));
  }

  snapshot() {
    return {
      ...this.counts,
      active: this.active,
      reservedKiB: this.reservedKiB,
      maxConcurrent: this.maxConcurrent,
      memoryBudgetKiB: this.memoryBudgetKiB,
    };
  }
}
