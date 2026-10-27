import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ConfigService } from '@nestjs/config';
import { AuthAbuseProtection } from './auth-abuse-protection.js';
import { RateLimitingModule } from '../../common/rate-limiting/rate-limiting.module.js';

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [RateLimitingModule],
      controllers: [AuthController],
      providers: [
        AuthAbuseProtection,
        { provide: AuthService, useValue: { register: vi.fn() } },
        ConfigService,
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
