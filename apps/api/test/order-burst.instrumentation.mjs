import { AsyncLocalStorage } from 'node:async_hooks';

export function transactionOutcome(error) {
  if (!error) return 'committed';
  const state =
    error.meta?.driverAdapterError?.cause?.originalCode ?? error.meta?.code;
  if (
    (error.name === 'DriverAdapterError' &&
      error.cause?.kind === 'TransactionWriteConflict') ||
    (error.name === 'PrismaClientKnownRequestError' &&
      (['P2034', 'P2002'].includes(error.code) ||
        (error.code === 'P2010' && ['40001', '40P01'].includes(state))))
  )
    return 'conflict';
  if ([404, 409].includes(error.getStatus?.())) return 'business_rejection';
  return 'unexpected_failure';
}

// Installed only in the owned fixture. No SQL, parameters, IDs or credentials recorded.
export function instrumentOrderTransactions(
  orders,
  prisma,
  getPhase,
  now = () => performance.now(),
) {
  const scope = new AsyncLocalStorage();
  const create = orders.create.bind(orders),
    transaction = prisma.$transaction.bind(prisma);
  const samples = [];
  let truncated = false;
  orders.create = (...args) =>
    scope.run({ phase: getPhase() }, () => create(...args));
  prisma.$transaction = async (...args) => {
    const context = scope.getStore();
    if (
      !context?.phase.startsWith('order-burst-') ||
      typeof args[0] !== 'function'
    )
      return transaction(...args);
    const began = now(),
      callback = args[0];
    let entered = null,
      outcome = 'committed';
    args[0] = (...values) => {
      entered = now();
      return callback(...values);
    };
    try {
      return await transaction(...args);
    } catch (error) {
      outcome = transactionOutcome(error);
      throw error;
    } finally {
      const ended = now();
      if (samples.length < 512)
        samples.push({
          phase: context.phase,
          outcome,
          durationMs: ended - began,
          acquisitionMs: entered === null ? null : entered - began,
          executionMs: entered === null ? null : ended - entered,
        });
      else truncated = true;
    }
  };
  return {
    samples,
    get truncated() {
      return truncated;
    },
    restore() {
      orders.create = create;
      prisma.$transaction = transaction;
      scope.disable();
    },
  };
}

function distribution(samples, key) {
  const values = samples
    .map((s) => s[key])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const p = (n) =>
    values.length
      ? Math.round(values[Math.ceil(values.length * n) - 1] * 1000) / 1000
      : null;
  return {
    samples: values.length,
    p50Ms: p(0.5),
    p95Ms: p(0.95),
    p99Ms: p(0.99),
    maxMs: values.length ? values.at(-1) : null,
  };
}
export function summarizeOrderTransactions(instrumentation) {
  const summarize = (samples) => {
    const outcomes = Object.fromEntries(
      ['committed', 'conflict', 'business_rejection', 'unexpected_failure'].map(
        (outcome) => [
          outcome,
          samples.filter((s) => s.outcome === outcome).length,
        ],
      ),
    );
    return {
      attempts: samples.length,
      outcomes,
      rollbackRate: samples.length
        ? (samples.length - outcomes.committed) / samples.length
        : null,
      conflictRate: samples.length ? outcomes.conflict / samples.length : null,
      unexpectedFailureRate: samples.length
        ? outcomes.unexpected_failure / samples.length
        : null,
      invocation: distribution(samples, 'durationMs'),
      acquisition: distribution(samples, 'acquisitionMs'),
      execution: distribution(samples, 'executionMs'),
    };
  };
  return {
    ...summarize(instrumentation.samples),
    truncated: instrumentation.truncated,
    samples: instrumentation.samples,
    phases: Object.fromEntries(
      [...new Set(instrumentation.samples.map((s) => s.phase))].map((phase) => [
        phase,
        summarize(instrumentation.samples.filter((s) => s.phase === phase)),
      ]),
    ),
  };
}
