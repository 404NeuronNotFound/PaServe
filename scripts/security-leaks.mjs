import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'apps/api/package.json'));
const { parse } = require('dotenv');
const sensitive = /(?:SECRET|PASSWORD|DATABASE_URL|DIRECT_URL|SERVICE_ROLE|PRIVATE_KEY)/u;
let backend = {};
try { backend = parse(await readFile(join(root, 'apps/api/.env'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const secrets = Object.entries({ ...backend, ...process.env })
  .filter(([key, value]) => sensitive.test(key) && typeof value === 'string' && value.length >= 16)
  .map(([, value]) => value);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const source = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = new Set();
for (const path of tracked)
  if (/(?:^|\/)\.env(?:\.|$)/u.test(path) && !path.endsWith('.example'))
    failures.add(`${path}: environment file is tracked`);
async function scan(path) {
  const content = await readFile(join(root, path), 'utf8');
  if (secrets.some((secret) => content.includes(secret)))
    failures.add(`${path}: contains a configured backend secret`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(content) ||
      /\bsb_secret_[A-Za-z0-9_-]{20,}/u.test(content))
    failures.add(`${path}: contains private key material`);
  for (const token of content.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu) ?? []) {
    try {
      if (JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).role === 'service_role')
        failures.add(`${path}: contains a privileged Supabase token`);
    } catch { /* Not a JWT. */ }
  }
}
const extensions = /\.(?:[cm]?[jt]sx?|json|ya?ml|md|html|css|sql|map|txt)$/u;
for (const path of new Set(source))
  if (!path.startsWith('artifacts/') && extensions.test(path)) await scan(path);
let assets = 0;
async function scanBuild(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scanBuild(path);
    else if (extensions.test(path)) { await scan(relative(root, path)); assets++; }
  }
}
await scanBuild(join(root, 'apps/web/dist'));
assert.equal(failures.size, 0, `Secret exposure checks failed:\n${[...failures].join('\n')}`);
console.log(`Secret exposure checks passed for repository sources and ${assets} frontend build files. Values were not printed. This is a targeted scan, not a complete secret-history audit.`);
