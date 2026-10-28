export function databasePoolPolicy(config: Record<string, unknown>) {
  const integer = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const value = Number(config[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${name} must be an integer between ${min} and ${max}`);
    return value;
  };
  const max = integer('DB_POOL_MAX', 5, 1, 50);
  const maxWaiting = integer('DB_POOL_MAX_WAITING', 20, 0, 200);
  const idleTimeoutMillis = integer(
    'DB_POOL_IDLE_TIMEOUT_MS',
    10_000,
    100,
    60_000,
  );
  const maxLifetimeSeconds = integer(
    'DB_POOL_MAX_LIFETIME_SECONDS',
    300,
    1,
    3600,
  );
  const hasBudget = config.DB_POOL_CONNECTION_BUDGET !== undefined;
  const hasProcesses = config.DB_POOL_MAX_PROCESSES !== undefined;
  if (hasBudget !== hasProcesses)
    throw new Error(
      'Set DB_POOL_CONNECTION_BUDGET and DB_POOL_MAX_PROCESSES together',
    );
  const declaredProcesses = hasProcesses
    ? integer('DB_POOL_MAX_PROCESSES', 1, 1, 1000)
    : undefined;
  const connectionBudget = hasBudget
    ? integer('DB_POOL_CONNECTION_BUDGET', 1, 1, 50_000)
    : undefined;
  if (
    declaredProcesses !== undefined &&
    connectionBudget !== undefined &&
    max * declaredProcesses > connectionBudget
  )
    throw new Error('Declared API pools exceed DB_POOL_CONNECTION_BUDGET');
  return Object.freeze({
    max,
    maxWaiting,
    idleTimeoutMillis,
    maxLifetimeSeconds,
    declaredProcesses,
    connectionBudget,
  });
}

export type DatabasePoolPolicy = ReturnType<typeof databasePoolPolicy>;
