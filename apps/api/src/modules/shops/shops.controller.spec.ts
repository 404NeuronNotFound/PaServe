import { Test, TestingModule } from '@nestjs/testing';
import { ShopsController } from './shops.controller.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

describe('ShopsController', () => {
  let controller: ShopsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShopsController],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ShopsController>(ShopsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
