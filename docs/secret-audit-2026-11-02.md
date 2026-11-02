# Private credential audit - 2 November 2026

No private credential exposure was found in the checked local repository,
builds/artifacts or Git objects. No credential values or matching snippets were
printed, no keys were rotated, and no live service configuration was changed.

The scan checked configured private values, database passwords, privileged
Supabase JWTs, Supabase secret keys, Brevo API/SMTP keys, private-key headers and
selected common provider token formats. It checked 2,902 working/build/artifact
files and 6,219 local Git blobs, including reachable history, reflogs and dangling
objects. All four discovered private environment files are ignored by Git, and
no tracked or historical non-example environment file was found.

One key-shaped receipt-validation test input is deliberately fake. Its single
exact fingerprint is approved only at its existing test path, including old
versions of that test. No other token or file is exempted; configured real secret
values are always flagged even if they match an approved fixture.

## Protection added

- Frontend builds and development startup reject unapproved populated `VITE_`
  names, recognizable private credentials and private values copied from the
  build environment into public configuration.
- The Supabase browser key setting rejects service-role and authenticated-user
  JWTs. The browser's public anon/publishable key and OAuth/site identifiers
  remain public by design; they cannot be made secret inside browser JavaScript.
- The normal fast leak check now also checks configured API/access/refresh/SMTP
  keys and Brevo key formats. The deeper audit scans local Git objects and
  ignored build/artifact output as well.
- Host-local `.vercel`/`.aws` directories and private `.key`/`.p12`/`.pfx` files
  are ignored. Environment files and local camera certificates remain ignored.

Private API keys belong only in backend/host secrets. Brevo SMTP credentials
configured in Supabase belong in its server-side settings, never a `VITE_` value.

## Repeat checks

```sh
pnpm test:leaks
pnpm audit:secrets
python -B scripts/test_audit_secrets.py
```

The deeper audit requires Python, Node, Git and the installed API dotenv parser.
It prints paths, object IDs, rule labels and counts; never values or source lines.
It reads local private environment values only for comparisons and intentionally
does not report those ignored files as leaks. Downloaded tools, dependencies,
host-local credentials and local HTTPS private files are excluded from the
working-tree scan; all local Git blobs are scanned independently.

Validation: detector tests, frontend credential/security/receipt tests, Vercel
configuration tests, frontend lint, release build and built-asset leak check
passed. Release build settings were process-only; saved environment files were
not changed.

This is a local audit, not proof a key has never been disclosed elsewhere. It
does not inspect provider dashboards, remote-only Git history, hosting logs,
previous public deployments, external messages or third-party copies. If a real
private key is found in any of those places, revoke/rotate it with its provider;
deleting the visible copy alone does not make that credential private again.
