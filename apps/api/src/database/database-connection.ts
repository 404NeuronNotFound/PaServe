import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import type { PoolConfig } from 'pg';

/** Explicit CA configuration works in managed hosts without startup-only NODE_EXTRA_CA_CERTS. */
export function databaseConnection(
  config: Record<string, unknown>,
  migration = false,
): PoolConfig {
  const raw =
    migration &&
    typeof config.DIRECT_DATABASE_URL === 'string' &&
    config.DIRECT_DATABASE_URL.trim()
      ? config.DIRECT_DATABASE_URL
      : config.DATABASE_URL;
  if (typeof raw !== 'string' || !raw.trim())
    throw new Error('DATABASE_URL is not configured');
  const inline =
    typeof config.DATABASE_CA_CERT === 'string'
      ? config.DATABASE_CA_CERT.trim()
      : '';
  const file =
    typeof config.DATABASE_CA_CERT_PATH === 'string'
      ? config.DATABASE_CA_CERT_PATH.trim()
      : '';
  if (inline && file)
    throw new Error(
      'Set only one of DATABASE_CA_CERT or DATABASE_CA_CERT_PATH',
    );
  if (!inline && !file) return { connectionString: raw };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Database URL is invalid');
  }
  if (
    url.searchParams.get('sslmode') !== 'verify-full' ||
    config.NODE_TLS_REJECT_UNAUTHORIZED === '0'
  )
    throw new Error(
      'Custom database trust requires sslmode=verify-full and certificate verification',
    );
  if (
    ['sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat'].some((key) =>
      url.searchParams.has(key),
    )
  )
    throw new Error(
      'Use DATABASE_CA_CERT or DATABASE_CA_CERT_PATH without URL certificate parameters',
    );
  let ca: string;
  try {
    ca = inline ? inline.replace(/\\n/gu, '\n') : readFileSync(file, 'utf8');
    const certificate = new X509Certificate(ca);
    if (
      !certificate.ca ||
      Date.parse(certificate.validTo) <= Date.now() ||
      Date.parse(certificate.validFrom) > Date.now()
    )
      throw new Error('Invalid CA');
  } catch {
    throw new Error(
      'Database CA must be a readable, valid CA certificate from the provider',
    );
  }
  // node-postgres URL ssl parameters replace the ssl object; remove only after
  // requiring verify-full, then explicitly retain hostname and CA verification.
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true },
  };
}
