import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ProductImageResponse } from '@paserve/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { ProductsRepository } from './products.repository.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { TenantResourcesService } from '../tenancy/tenant-resources.service.js';
import {
  ProductImageProcessor,
  type ProductImageFile,
} from './product-image.processor.js';
import { ProductImageStorage } from './product-image.storage.js';
@Injectable()
export class ProductImageService {
  constructor(
    private readonly repository: ProductsRepository,
    private readonly members: ShopMembersService,
    private readonly resources: TenantResourcesService,
    private readonly processor: ProductImageProcessor,
    private readonly storage: ProductImageStorage,
  ) {}
  async upload(
    userId: string,
    shopId: string,
    productId: string,
    file?: ProductImageFile,
  ): Promise<ProductImageResponse> {
    await this.members.requirePermission(userId, shopId, 'shop.menu.manage');
    await this.resources.requireResource(userId, shopId, 'product', productId);
    if (!(await this.repository.findForImage(userId, shopId, productId)))
      throw this.unavailable();
    const buffer = await this.processor.process(file);
    const uploaded = await this.storage.upload(shopId, productId, buffer);
    try {
      const product = await this.repository.update(
        userId,
        shopId,
        productId,
        undefined,
        { imageUrl: uploaded.imageUrl },
      );
      return {
        product: {
          ...product,
          price: product.price.toFixed(2),
          createdAt: product.createdAt.toISOString(),
        },
        storagePath: uploaded.storagePath,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2025', 'P2003'].includes(error.code)
      ) {
        await this.storage.remove(uploaded.storagePath);
        throw this.unavailable();
      }
      // An uncertain database failure may have committed. Keep the object to avoid breaking a saved reference.
      throw new ServiceUnavailableException({
        code: 'PRODUCT_IMAGE_SAVE_UNCERTAIN',
        message:
          'We couldn’t confirm the image save. Refresh products before trying again.',
      });
    }
  }
  private unavailable() {
    return new NotFoundException({
      code: 'RESOURCE_NOT_ACCESSIBLE',
      message:
        'The product is unavailable, archived, or your access changed. Refresh products to continue.',
    });
  }
}
