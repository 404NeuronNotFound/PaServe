import { ConfigService } from '@nestjs/config';
import { hash, verify } from 'argon2';
import {
  PasswordHashService,
  PASSWORD_HASH_POLICY,
} from './password-hash.service.js';

vi.mock('argon2', () => ({ argon2id: 2, hash: vi.fn(), verify: vi.fn() }));
const digest = (memory = 65_536, time = 3, lanes = 4) =>
  `$argon2id$v=19$m=${memory},t=${time},p=${lanes}$${Buffer.alloc(16, 1).toString('base64').replace(/=+$/u, '')}$${Buffer.alloc(32, 2).toString('base64').replace(/=+$/u, '')}`;
const nativeHash = vi.mocked(hash);
const nativeVerify = vi.mocked(verify);

describe('native password hashing capacity', () => {
  it.each(['m=65536,p=4,t=3', 'm=65536,t=3,p=4'])(
    'verifies existing PHC parameter order %s without rewriting its cost',
    async (parameters) => {
      nativeVerify.mockResolvedValue(true);
      const service = new PasswordHashService(new ConfigService());
      const encoded = digest().replace('m=65536,t=3,p=4', parameters);
      expect(await service.verify(encoded, 'fixture')).toBe(true);
      expect(nativeVerify).toHaveBeenCalledWith(encoded, 'fixture');
    },
  );
  beforeEach(() => {
    vi.stubEnv('UV_THREADPOOL_SIZE', '4');
    nativeHash.mockReset().mockResolvedValue(digest());
    nativeVerify.mockReset().mockResolvedValue(false);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('pins the existing Argon2id work factor and keeps each hash independently salted by the library', async () => {
    const service = new PasswordHashService(new ConfigService());
    await service.hash('password fixture');
    expect(nativeHash).toHaveBeenCalledWith('password fixture', {
      type: 2,
      version: 19,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 4,
      hashLength: 32,
    });
    expect(PASSWORD_HASH_POLICY).not.toHaveProperty('salt');
  });
  it('shares and awaits one startup dummy hash instead of launching untracked jobs', async () => {
    let finish!: (value: string) => void;
    nativeHash.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const service = new PasswordHashService(new ConfigService());
    const startup = service.onModuleInit();
    const dummy = service.dummyHash();
    expect(nativeHash).toHaveBeenCalledOnce();
    expect(service.snapshot().active).toBe(1);
    finish(digest());
    await startup;
    expect(await dummy).toBe(digest());
    expect(service.snapshot().active).toBe(0);
  });
  it('rejects overflow before submitting any more native work and holds capacity through caller timeout', async () => {
    const finish: ((value: string) => void)[] = [];
    nativeHash.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(resolve);
        }),
    );
    const service = new PasswordHashService(new ConfigService());
    const first = service.hash('first');
    const second = service.hash('second');
    await expect(service.hash('overflow')).rejects.toMatchObject({
      status: 429,
      retryAfter: 1,
    });
    // Abandoning a caller's wait cannot cancel/release the native job.
    await Promise.race([first, Promise.resolve('caller timed out')]);
    await expect(service.hash('still busy')).rejects.toMatchObject({
      status: 429,
    });
    expect(nativeHash).toHaveBeenCalledTimes(2);
    expect(service.snapshot()).toMatchObject({
      active: 2,
      reservedKiB: 131_072,
      peakActive: 2,
    });
    finish[0](digest());
    finish[1](digest());
    await Promise.all([first, second]);
    nativeHash.mockResolvedValue(digest());
    await service.hash('recovered');
    expect(service.snapshot()).toMatchObject({
      active: 0,
      reservedKiB: 0,
      rejected: 2,
    });
  });
  it('accounts for encoded verification memory, not only the number of promises', async () => {
    let finish!: (value: boolean) => void;
    nativeVerify.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const service = new PasswordHashService(new ConfigService());
    const large = service.verify(digest(131_072), 'fixture');
    await expect(service.hash('would exceed memory')).rejects.toMatchObject({
      status: 429,
    });
    expect(nativeHash).not.toHaveBeenCalled();
    expect(service.snapshot()).toMatchObject({
      active: 1,
      reservedKiB: 131_072,
    });
    finish(false);
    await large;
    expect(service.snapshot().reservedKiB).toBe(0);
  });
  it('releases memory and concurrency only after native rejection and permits recovery', async () => {
    nativeHash.mockRejectedValueOnce(new Error('native failure'));
    const service = new PasswordHashService(new ConfigService());
    await expect(service.hash('fixture')).rejects.toThrow('native failure');
    expect(service.snapshot()).toMatchObject({
      active: 0,
      reservedKiB: 0,
      failed: 1,
    });
    await service.hash('recovery');
  });
  it.each([
    digest(999_999),
    digest(65_536, 99),
    digest(65_536, 3, 99),
    'corrupt hash',
    '$argon2id$v=19$m=65536,t=3,p=4$xxxxxxxxxxxxxxxxx$xxxxxxxxxxxxxxxxx',
  ])(
    'never passes malformed/out-of-envelope PHC records to native verification',
    async (unsafe) => {
      const service = new PasswordHashService(new ConfigService());
      await service.onModuleInit();
      nativeVerify.mockResolvedValue(true);
      expect(await service.verify(unsafe, 'fixture')).toBe(false);
      expect(nativeVerify).toHaveBeenCalledWith(digest(), 'fixture');
      expect(service.snapshot().invalidDigests).toBe(1);
    },
  );
  it('does not cache password-verification outcomes or expose credentials in telemetry', async () => {
    const service = new PasswordHashService(new ConfigService());
    await service.verify(digest(), 'private-password');
    await service.verify(digest(), 'private-password');
    expect(nativeVerify).toHaveBeenCalledTimes(2);
    const snapshot = JSON.stringify(service.snapshot());
    expect(snapshot).not.toContain('private-password');
    expect(snapshot).not.toContain('$argon2');
  });
  it.each([
    { AUTH_HASH_MAX_CONCURRENT: '0' },
    { AUTH_HASH_MAX_CONCURRENT: '4' },
    { AUTH_HASH_MEMORY_MB: '63' },
    { AUTH_HASH_MEMORY_MB: '513' },
    { AUTH_HASH_MEMORY_MB: 'NaN' },
  ])('fails startup for unsafe capacity configuration: %j', (settings) => {
    expect(
      () => new PasswordHashService(new ConfigService(settings)),
    ).toThrow();
  });
  it('leaves pool headroom and never changes UV_THREADPOOL_SIZE at runtime', () => {
    vi.stubEnv('UV_THREADPOOL_SIZE', '2');
    const service = new PasswordHashService(new ConfigService());
    expect(service.maxConcurrent).toBe(1);
    expect(process.env.UV_THREADPOOL_SIZE).toBe('2');
    vi.stubEnv('UV_THREADPOOL_SIZE', '1');
    expect(() => new PasswordHashService(new ConfigService())).toThrow(
      /UV_THREADPOOL_SIZE/,
    );
  });
});
