import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
);
const probe = `
  import { createRequire } from 'node:module';
  import { resolve } from 'node:path';
  const require = createRequire(resolve('package.json'));
  const throttler = require('@nestjs/throttler');
  require('@nestjs/jwt');
  const core = await import('@nestjs/core');
  console.log(JSON.stringify({ requireModule: process.features.require_module, loaded: typeof throttler.ThrottlerModule === 'function' && typeof core.NestFactory.create === 'function' }));
`;
const run = (options) =>
  spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: apiRoot,
    env: { ...process.env, NODE_OPTIONS: options },
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });

test('reproduces Vercel ERR_REQUIRE_ESM with require(ESM) disabled', () => {
  const result = run('--no-experimental-require-module');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ERR_REQUIRE_ESM/);
});

test('deployed runtime flag loads the real throttler/JWT/Nest dependencies', () => {
  const result = run(config.env.NODE_OPTIONS);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    requireModule: true,
    loaded: true,
  });
});
