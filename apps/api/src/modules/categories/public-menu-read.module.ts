import { Module } from '@nestjs/common';
import { PublicMenuReadGate } from './public-menu-read-gate.js';

/** A single admission budget shared by public catalog menu/detail reads. */
@Module({ providers: [PublicMenuReadGate], exports: [PublicMenuReadGate] })
export class PublicMenuReadModule {}
