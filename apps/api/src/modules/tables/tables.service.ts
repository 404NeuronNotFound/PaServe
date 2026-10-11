import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  compareTableNumbers,
  normalizeTableNumber,
  type CreateTableResponse,
  type TablesResponse,
} from '@paserve/contracts';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { ShopMembersService } from '../shop-members/shop-members.service.js';
import { TablesRepository } from './tables.repository.js';
import type { CreateTableDto } from './create-table.dto.js';

const lostAccess = () =>
  new ForbiddenException({
    code: 'SHOP_PERMISSION_REQUIRED',
    message: 'Only this shop’s owner or admin can manage tables.',
  });

@Injectable()
export class TablesService {
  constructor(
    private readonly repository: TablesRepository,
    private readonly members: ShopMembersService,
  ) {}

  async list(userId: string, shopId: string): Promise<TablesResponse> {
    await this.members.requirePermission(
      userId,
      shopId,
      'shop.operations.manage',
    );
    const result = await this.repository.list(userId, shopId);
    if (!result) throw lostAccess();
    return {
      tables: result.tables
        .map((table) => ({
          ...table,
          createdAt: table.createdAt.toISOString(),
        }))
        .sort(compareTableNumbers),
    };
  }

  async create(
    userId: string,
    shopId: string,
    dto: CreateTableDto,
  ): Promise<CreateTableResponse> {
    await this.members.requirePermission(
      userId,
      shopId,
      'shop.operations.manage',
    );
    try {
      const number = normalizeTableNumber(dto.number);
      const result = await this.repository.create(
        userId,
        shopId,
        number,
        /^\d+$/.test(number) ? `T${number}` : `T-${randomUUID()}`,
      );
      const table = result.tables[0];
      return { table: { ...table, createdAt: table.createdAt.toISOString() } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') throw lostAccess();
        if (error.code === 'P2002')
          throw new ConflictException({
            code: 'TABLE_ALREADY_EXISTS',
            message: 'This table number or label already exists in this shop.',
            fieldErrors: {
              number: ['Choose a different table number or label.'],
            },
          });
      }
      throw error;
    }
  }
}
