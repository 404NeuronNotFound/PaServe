import { Test, TestingModule } from '@nestjs/testing';
import { ShopsController } from './shops.controller.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ShopsService } from './shops.service.js';
import { ShopMembershipGuard } from '../shop-members/guards/shop-membership.guard.js';
import { RolesGuard } from '../shop-members/guards/roles.guard.js';

describe('ShopsController', () => {
  let controller: ShopsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShopsController],
      providers: [{ provide: ShopsService, useValue: { create: vi.fn() } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ShopMembershipGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ShopsController>(ShopsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
