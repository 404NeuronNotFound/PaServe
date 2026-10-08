import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Controller('shops')
@UseGuards(JwtAuthGuard)
export class ShopsController {}
