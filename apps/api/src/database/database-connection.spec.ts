import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { databaseConnection } from './database-connection.js';

const ca = rootCertificates.find((value) => {
  const cert = new X509Certificate(value);
  return (
    cert.ca &&
    Date.parse(cert.validTo) > Date.now() &&
    Date.parse(cert.validFrom) < Date.now()
  );
})!;
const url =
  'postgresql://fixture:fixture@pool.example.test/postgres?sslmode=verify-full';

it('preserves existing local configuration and selects a separate migration connection only when requested', () => {
  const env = {
    DATABASE_URL: url,
    DIRECT_DATABASE_URL: 'postgresql://fixture@direct.example.test/db',
  };
  expect(databaseConnection(env).connectionString).toBe(url);
  expect(databaseConnection(env, true).connectionString).toBe(
    env.DIRECT_DATABASE_URL,
  );
});
it('passes the CA explicitly without letting connection-string options override verification', () => {
  const options = databaseConnection({
    DATABASE_URL: url,
    DATABASE_CA_CERT: ca,
  });
  expect(new URL(options.connectionString!).searchParams.has('sslmode')).toBe(
    false,
  );
  expect(options.ssl).toEqual({ ca, rejectUnauthorized: true });
  expect(
    databaseConnection({
      DATABASE_URL: url,
      DATABASE_CA_CERT: ca.replace(/\n/gu, '\\n'),
    }).ssl,
  ).toEqual(options.ssl);
});
it('rejects missing, ambiguous, unreadable and malformed trust configuration without exposing values', () => {
  expect(() => databaseConnection({})).toThrow('not configured');
  expect(() =>
    databaseConnection({
      DATABASE_URL: url,
      DATABASE_CA_CERT: ca,
      DATABASE_CA_CERT_PATH: 'fixture.crt',
    }),
  ).toThrow('only one');
  expect(() =>
    databaseConnection({
      DATABASE_URL: url,
      DATABASE_CA_CERT_PATH: 'missing-fixture.crt',
    }),
  ).toThrow('readable');
  expect(() =>
    databaseConnection({
      DATABASE_URL: url,
      DATABASE_CA_CERT: 'invalid-fixture',
    }),
  ).toThrow('valid CA');
  expect(() =>
    databaseConnection({
      DATABASE_URL: 'invalid-private-fixture',
      DATABASE_CA_CERT: ca,
    }),
  ).toThrow('Database URL is invalid');
});
it('refuses unverified SSL and URL certificate overrides when explicit trust is configured', () => {
  for (const DATABASE_URL of [
    url.replace('verify-full', 'require'),
    `${url}&sslrootcert=other.crt`,
    `${url}&ssl=false`,
    `${url}&uselibpqcompat=true`,
  ])
    expect(() =>
      databaseConnection({ DATABASE_URL, DATABASE_CA_CERT: ca }),
    ).toThrow();
  expect(() =>
    databaseConnection({
      DATABASE_URL: url,
      DATABASE_CA_CERT: ca,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    }),
  ).toThrow();
});
