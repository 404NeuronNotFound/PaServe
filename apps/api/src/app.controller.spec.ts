import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { PrismaService } from './database/prisma.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: PrismaService,
          useValue: { $queryRaw: vi.fn().mockResolvedValue([{ healthy: 1 }]) },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('returns the API identity', () => {
      expect(appController.getRoot()).toEqual({
        app: 'PaServe API',
        status: 'running',
      });
    });
    it('checks the database before returning healthy', async () => {
      await expect(appController.health()).resolves.toEqual({
        api: 'ok',
        database: 'connected',
      });
    });
  });
});
