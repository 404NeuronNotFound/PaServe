import { Test, type TestingModule } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import {
  rolesForShopPermissions,
  SHOP_ROLES,
  type ShopPermission,
} from '@paserve/contracts';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { SHOP_PERMISSIONS_KEY } from '../src/modules/shop-members/decorators/permissions.decorator.js';
import { SHOP_ROLES_KEY } from '../src/modules/shop-members/roles.metadata.js';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/modules/shop-members/guards/roles.guard.js';
import { ShopMembershipGuard } from '../src/modules/shop-members/guards/shop-membership.guard.js';

describe('registered tenant route policy audit', () => {
  let module: TestingModule;
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
  });
  afterAll(async () => {
    await module.close();
  });

  it('keeps every business route aligned with the central matrix and live guards', () => {
    const reflector = module.get(Reflector);
    let audited = 0;
    for (const { metatype } of module.get(DiscoveryService).getControllers()) {
      if (!metatype) continue;
      const base = Reflect.getMetadata(PATH_METADATA, metatype);
      if (typeof base !== 'string') continue;
      for (const key of Object.getOwnPropertyNames(metatype.prototype)) {
        if (key === 'constructor') continue;
        const handler = metatype.prototype[key];
        if (
          typeof handler !== 'function' ||
          Reflect.getMetadata(METHOD_METADATA, handler) === undefined
        )
          continue;
        const path =
          `${base}/${Reflect.getMetadata(PATH_METADATA, handler) ?? ''}`.replace(
            /\/$/,
            '',
          );
        if (!path.startsWith('shops/:shopId')) continue;
        audited++;
        const targets = [handler, metatype];
        const guards = targets.flatMap(
          (target) => Reflect.getMetadata(GUARDS_METADATA, target) ?? [],
        );
        expect(guards, path).toContain(JwtAuthGuard);
        if (path === 'shops/:shopId/membership') {
          expect(guards, path).toContain(ShopMembershipGuard);
          continue;
        }
        const roles = reflector.getAllAndOverride(SHOP_ROLES_KEY, targets);
        expect(guards, path).toContain(RolesGuard);
        if (path === 'shops/:shopId/orders/events') {
          // Workflow-specific permissions are rechecked by the stream service.
          expect(roles, path).toEqual(SHOP_ROLES);
          continue;
        }
        const permissions = reflector.getAllAndOverride<ShopPermission[]>(
          SHOP_PERMISSIONS_KEY,
          targets,
        );
        expect(permissions?.length, path).toBeGreaterThan(0);
        expect(roles, path).toEqual(rolesForShopPermissions(...permissions!));
      }
    }
    expect(audited).toBeGreaterThan(50);
  });
});
