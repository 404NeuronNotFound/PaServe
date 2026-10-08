import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {}
