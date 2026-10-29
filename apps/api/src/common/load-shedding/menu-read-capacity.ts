import { SetMetadata } from '@nestjs/common';

export const MENU_READ_CAPACITY = Symbol('paserve:menu-read-capacity');
/** Finite public catalog GETs only, never quotes, writes or SSE connections. */
export const MenuReadCapacity = () => SetMetadata(MENU_READ_CAPACITY, true);
