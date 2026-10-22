export function assertDemoSafety(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test')
    throw new Error('Demo writes require NODE_ENV=development or test.');
  if (env.ALLOW_DEMO_SEED !== 'true')
    throw new Error('Demo writes require ALLOW_DEMO_SEED=true.');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('A PostgreSQL target is required.');
  const target = `${url.hostname}${url.pathname}`;
  if (env.DEMO_DATABASE_TARGET !== target)
    throw new Error(
      `Explicit development target required: set DEMO_DATABASE_TARGET=${target}`,
    );
  return target;
}
