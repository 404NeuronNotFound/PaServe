import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { hash, verify } from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { PasswordHashService } from '../src/modules/auth/password-hash.service.js';
import { resetRateLimits } from './rate-limit-test-utils.js';

vi.mock('argon2', () => ({ argon2id: 2, hash: vi.fn(), verify: vi.fn() }));
const digest = `$argon2id$v=19$m=65536,t=3,p=4$${Buffer.alloc(16, 1).toString('base64').replace(/=+$/u, '')}$${Buffer.alloc(32, 2).toString('base64').replace(/=+$/u, '')}`;
describe('native hashing saturation HTTP contract', () => {
  let app: INestApplication;
  const repository = {
    findLoginAccount: vi.fn(),
    createSession: vi.fn(),
    createAccount: vi.fn(),
  };
  beforeAll(async () => {
    vi.mocked(hash).mockResolvedValue(digest);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(AuthRepository)
      .useValue(repository)
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          NODE_ENV: 'test',
          AUTH_BOT_CHALLENGE_ENABLED: 'false',
          AUTH_HASH_MAX_CONCURRENT: '1',
        }),
      )
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    resetRateLimits(app);
    repository.findLoginAccount
      .mockReset()
      .mockResolvedValue({
        id: 'fixture',
        isActive: true,
        passwordHash: digest,
      });
    repository.createSession.mockReset();
    repository.createAccount.mockReset();
    vi.mocked(hash).mockClear().mockResolvedValue(digest);
    vi.mocked(verify).mockReset().mockResolvedValue(false);
  });
  const login = () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-PaServe-Client', 'web')
      .send({
        email: 'fixture@example.test',
        password: 'incorrect fixture password',
      });
  it('returns retryable 429 without another native job or session write; normal API work proceeds', async () => {
    let finish!: (value: string) => void;
    vi.mocked(hash).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const passwords = app.get(PasswordHashService);
    const held = passwords.hash('private fixture');
    try {
      const blocked = await login().expect(429);
      expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blocked.headers['retry-after']).toBe('1');
      expect(blocked.headers['cache-control']).toBe('no-store');
      expect(blocked.headers['set-cookie']).toBeUndefined();
      expect(verify).not.toHaveBeenCalled();
      expect(repository.createSession).not.toHaveBeenCalled();
      await request(app.getHttpServer()).get('/api/v1').expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'new@example.test', password: 'valid fixture password' })
        .expect(429);
      expect(repository.createAccount).not.toHaveBeenCalled();
      expect(passwords.snapshot().active).toBe(1);
    } finally {
      finish(digest);
      await held;
    }
    await login().expect(401);
    expect(passwords.snapshot().active).toBe(0);
  });
});
