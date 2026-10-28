import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import {
  CriticalAccessService,
  CRITICAL_CAPACITY,
} from './critical-capacity.js';
import { CashPaymentController } from '../../modules/orders/cash-payment.controller.js';
import { OrderDecisionController } from '../../modules/orders/order-decision.controller.js';
import { OrderQrController } from '../../modules/orders/order-qr.controller.js';
import { PreparationStartController } from '../../modules/orders/preparation-start.controller.js';
import { PreparationReadyController } from '../../modules/orders/preparation-ready.controller.js';
import { PreparationCompleteController } from '../../modules/orders/preparation-complete.controller.js';
import { ActiveOrdersController } from '../../modules/orders/active-orders.controller.js';
import { PreparationQueueController } from '../../modules/orders/preparation-queue.controller.js';
import { PublicMenuEventsController } from '../../modules/categories/public-menu-events.controller.js';

describe('critical admission credentials and route coverage', () => {
  const secret = 'fixture-only-access-secret-longer-than-32-characters';
  const jwt = new JwtService();
  const access = new CriticalAccessService(
    new ConfigService({ JWT_ACCESS_SECRET: secret }),
    jwt,
  );
  const sign = (claims: Record<string, unknown> = {}, options = {}) =>
    jwt.sign(
      {
        sub: 'fixture-user',
        sid: 'fixture-session',
        type: 'access',
        ...claims,
      },
      {
        secret,
        algorithm: 'HS256',
        issuer: 'paserve-api',
        audience: 'paserve:web',
        expiresIn: 60,
        ...options,
      },
    );

  it('accepts a signed access token without treating it as live authorization', () => {
    expect(access.eligible(`Bearer ${sign()}`)).toBe(true);
  });
  it.each([
    ['refresh token', { type: 'refresh' }, {}],
    ['missing session', { sid: null }, {}],
    ['missing subject', { sub: null }, {}],
    ['invalid keep-signed-in claim', { keepSignedIn: 'yes' }, {}],
    ['expired token', {}, { expiresIn: -10 }],
    ['wrong issuer', {}, { issuer: 'another-service' }],
    ['wrong audience', {}, { audience: 'paserve:refresh' }],
    [
      'wrong signature',
      {},
      { secret: 'fixture-only-wrong-secret-longer-than-32-characters' },
    ],
    ['wrong algorithm', {}, { algorithm: 'HS384' }],
  ])('rejects %s from the reserved lane', (_, claims, options) => {
    expect(access.eligible(`Bearer ${sign(claims, options)}`)).toBe(false);
  });
  it.each([
    undefined,
    '',
    'Basic abc',
    'Bearer forged-token',
    `Bearer ${'x'.repeat(4097)}`,
  ])('rejects missing/malformed/oversized credentials', (header) => {
    expect(access.eligible(header)).toBe(false);
  });
  it('requires an expiry and a configured secret', () => {
    const noExpiry = jwt.sign(
      { sub: 'fixture-user', sid: 'fixture-session', type: 'access' },
      {
        secret,
        algorithm: 'HS256',
        issuer: 'paserve-api',
        audience: 'paserve:web',
      },
    );
    expect(access.eligible(`Bearer ${noExpiry}`)).toBe(false);
    expect(
      new CriticalAccessService(new ConfigService(), jwt).eligible(
        `Bearer ${sign()}`,
      ),
    ).toBe(false);
  });
  it('covers finite cashier/status paths without promoting history or public streams', () => {
    const reflector = new Reflector();
    for (const controller of [
      CashPaymentController,
      OrderDecisionController,
      OrderQrController,
      PreparationStartController,
      PreparationReadyController,
      PreparationCompleteController,
      ActiveOrdersController,
    ]) {
      expect(reflector.get(CRITICAL_CAPACITY, controller)).toBe(true);
    }
    for (const method of ['ready', 'list', 'preparing', 'completed']) {
      const handler = Object.getOwnPropertyDescriptor(
        PreparationQueueController.prototype,
        method,
      )?.value;
      expect(typeof handler).toBe('function');
      expect(reflector.get(CRITICAL_CAPACITY, handler)).toBe(
        method === 'completed' ? undefined : true,
      );
    }
    expect(
      reflector.get(CRITICAL_CAPACITY, PreparationQueueController),
    ).toBeUndefined();
    expect(
      reflector.get(CRITICAL_CAPACITY, PublicMenuEventsController),
    ).toBeUndefined();
  });
});
