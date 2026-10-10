import { Prisma } from '../generated/prisma/client.js';

/** Prisma query failures and pg adapter commit failures have different shapes. */
export function isTransactionConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return error.code === 'P2034';
  if (!(error instanceof Error) || error.name !== 'DriverAdapterError')
    return false;
  const cause = error.cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'kind' in cause &&
    cause.kind === 'TransactionWriteConflict'
  );
}
