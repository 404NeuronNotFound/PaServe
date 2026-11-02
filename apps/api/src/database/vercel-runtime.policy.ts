/** Validate host constraints before opening any database connection. */
export function validateVercelRuntime(config: Record<string, unknown>) {
  if (config.VERCEL !== '1') return;
  let database: URL;
  try {
    database = new URL(
      typeof config.DATABASE_URL === 'string' ? config.DATABASE_URL : '',
    );
  } catch {
    throw new Error(
      'Vercel requires a valid pooled DATABASE_URL with sslmode=verify-full',
    );
  }
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    database.searchParams.get('sslmode') !== 'verify-full' ||
    config.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  )
    throw new Error(
      'Vercel requires certificate-verified PostgreSQL TLS (sslmode=verify-full)',
    );
  if (!config.DB_POOL_MAX_PROCESSES || !config.DB_POOL_CONNECTION_BUDGET)
    throw new Error(
      'Vercel requires explicit DB_POOL_MAX_PROCESSES and DB_POOL_CONNECTION_BUDGET',
    );
  // SSE lasts 60 seconds; leave time for setup and teardown under the 120s function cap.
  if (Number(config.API_STREAM_SETUP_TIMEOUT_MS ?? 10000) > 30000)
    throw new Error('Vercel stream setup timeout must not exceed 30000ms');
}
