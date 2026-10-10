import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { isTransactionConflict } from './transaction-conflict.js';

describe('transaction conflict classification', () => {
  it('recognizes Prisma serialization failures', () => {
    expect(
      isTransactionConflict(
        new Prisma.PrismaClientKnownRequestError('Concurrent change', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      ),
    ).toBe(true);
  });
  it.each(['40001', '40P01'])('recognizes pg adapter conflict %s', (code) => {
    const error = new Error('Conflict', {
      cause: { kind: 'TransactionWriteConflict', originalCode: code },
    });
    error.name = 'DriverAdapterError';
    expect(isTransactionConflict(error)).toBe(true);
  });
  it('does not misclassify uncertain saves or other database failures', () => {
    const unavailable = new Error('Database unavailable', {
      cause: { kind: 'ConnectionClosed' },
    });
    unavailable.name = 'DriverAdapterError';
    for (const error of [
      null,
      undefined,
      {},
      new Error('TransactionWriteConflict'),
      unavailable,
      new Prisma.PrismaClientKnownRequestError('Unknown', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    ])
      expect(isTransactionConflict(error)).toBe(false);
  });
});
