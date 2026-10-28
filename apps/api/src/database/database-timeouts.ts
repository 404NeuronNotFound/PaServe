/** Pool acquisition is bounded; SQL deadlines are enforced by PostgreSQL itself. */
export function databaseTimeouts(config: Record<string, unknown>) {
  const milliseconds = (name: string, fallback: number) => {
    const value = Number(config[name] ?? fallback);
    if (!Number.isInteger(value) || value < 100 || value > 60_000)
      throw new Error(`${name} must be an integer between 100 and 60000`);
    return value;
  };
  const statement = milliseconds('DB_STATEMENT_TIMEOUT_MS', 10_000);
  const lock = milliseconds('DB_LOCK_TIMEOUT_MS', 3_000);
  if (lock >= statement)
    throw new Error(
      'DB_LOCK_TIMEOUT_MS must be less than DB_STATEMENT_TIMEOUT_MS',
    );
  return {
    pool: {
      statement_timeout: statement,
      lock_timeout: lock,
      idle_in_transaction_session_timeout: milliseconds(
        'DB_IDLE_TRANSACTION_TIMEOUT_MS',
        15_000,
      ),
      connectionTimeoutMillis: milliseconds('DB_CONNECTION_TIMEOUT_MS', 3_000),
    },
    transactionOptions: {
      maxWait: milliseconds('DB_TRANSACTION_MAX_WAIT_MS', 3_000),
      timeout: milliseconds('DB_TRANSACTION_TIMEOUT_MS', 30_000),
    },
  };
}
