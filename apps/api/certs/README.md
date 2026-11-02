# Supabase database trust certificate

Download this project's **server root CA certificate** from Supabase Dashboard
Database Settings → SSL Configuration and save it locally as `supabase-ca.crt`.
This is a public certificate, not a private key, JWT or API key.

For local API/preflight checks, set `DATABASE_CA_CERT_PATH` to its absolute path
and use `sslmode=verify-full` in the database URL. For Vercel, set the full PEM
content as `DATABASE_CA_CERT` instead; this avoids relying on a local file being
included in the deployed function. Set only one of these two variables.

The API rejects invalid/expired CA certificates and retains CA and hostname
verification. No certificate was supplied or installed by the release preparation.

Prisma migration CLI is separate from the runtime driver. Supply this trusted
certificate with its supported `sslrootcert` URL option (a process-only migration
connection), and restore/recheck the ordinary configuration afterward. Do not
disable TLS or certificate validation to make a migration connect.

Source: [Supabase SSL verification](https://supabase.com/docs/guides/platform/ssl-enforcement).
