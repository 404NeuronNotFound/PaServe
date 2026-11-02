"""Redacted local audit: working files, build output and every local Git blob."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SENSITIVE = re.compile(r'SECRET|PASSWORD|DATABASE_URL|DIRECT_URL|SERVICE_ROLE|PRIVATE_KEY|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|SMTP_KEY', re.I)
PATTERNS = {
    'private key': rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----',
    'Supabase secret key': rb'\bsb_secret_[A-Za-z0-9_-]{20,}',
    'Brevo API/SMTP key': rb'\b(?:xkeysib-|xsmtpsib-)[A-Za-z0-9_-]{20,}',
    'GitHub token': rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})',
    'AWS access key identifier': rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'Stripe/OpenAI private key': rb'\b(?:sk_live_|sk[_-]proj-|sk-svcacct-)[A-Za-z0-9_-]{20,}',
}
JWT = re.compile(rb'eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+')
# One reviewed, intentionally fake receipt-validation input, pinned by exact hash
# AND path. This cannot suppress a different credential or a copy in another file.
APPROVED_FIXTURES = {
    'apps/web/src/pages/public/ReceiptPaymentMethod.test.tsx': {
        ('Stripe/OpenAI private key', 'c5786e3b178fe3899a19a97e57767306858445ec43b4f23dd10df6ecf2f0674a'),
    },
}

def detect(content, secrets=(), approved=()):
    rules = {name for name, pattern in PATTERNS.items()
             if any((name, hashlib.sha256(match[0]).hexdigest()) not in approved
                    for match in re.finditer(pattern, content))}
    if any(secret in content for secret in secrets):
        rules.add('configured private credential')
    for match in JWT.finditer(content):
        try:
            payload = json.loads(base64.urlsafe_b64decode(match[1] + b'=' * (-len(match[1]) % 4)))
            if isinstance(payload, dict) and payload.get('role') == 'service_role':
                rules.add('privileged Supabase JWT')
        except (ValueError, TypeError, UnicodeError):
            pass
    return sorted(rules)

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, stderr=subprocess.DEVNULL)

def main():
    # Load values only into memory. Never print values, matching lines or snippets.
    configured = dict(os.environ)
    private_env_files = []
    for directory in [ROOT, ROOT / 'apps/api', ROOT / 'apps/web']:
        for path in directory.glob('.env*'):
            if not path.is_file() or path.name.endswith('.example'):
                continue
            private_env_files.append(path)
    # Use the same dotenv parser as the API, including quoted/multiline values.
    # Child stdout is captured directly into memory, never forwarded to the console.
    reader = """
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { parse } = createRequire(resolve('apps/api/package.json'))('dotenv');
const paths = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(paths.map(path => parse(readFileSync(path)))));
"""
    values = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', reader],
        input=json.dumps([str(path) for path in private_env_files]).encode(), cwd=ROOT, stderr=subprocess.DEVNULL))
    for path, env in zip(private_env_files, values):
        for name, value in env.items():
            configured[f'{path}:{name}'] = value
    secrets = {value.encode() for key, value in configured.items() if SENSITIVE.search(key.rsplit(':', 1)[-1]) and len(value) >= 12 and not key.endswith('SUPABASE_ANON_KEY')}
    # Connection passwords can leak independently of their full URL.
    from urllib.parse import urlsplit, unquote
    for key, value in configured.items():
        if 'DATABASE_URL' in key or 'DIRECT_URL' in key:
            try:
                password = urlsplit(value).password
                if password and len(unquote(password)) >= 12:
                    secrets.add(unquote(password).encode())
            except ValueError:
                pass
    findings = []
    tracked = set(git('ls-files', '-z').decode().split('\0'))
    for name in tracked:
        if re.search(r'(^|/)\.env($|\.)', name) and not name.endswith('.example'):
            findings.append({'scope': 'index', 'path': name, 'rules': ['tracked environment file']})
    for path in private_env_files:
        if subprocess.run(['git', 'check-ignore', '--quiet', '--', str(path.relative_to(ROOT))], cwd=ROOT).returncode != 0:
            findings.append({'scope': 'working', 'path': path.relative_to(ROOT).as_posix(), 'rules': ['environment file not ignored']})
    skip = {'.git', 'node_modules', '.local-tools', '.local-https', '.vercel', '.aws'}
    files = 0
    for directory, directories, names in os.walk(ROOT):
        directories[:] = [name for name in directories if name not in skip]
        for name in names:
            path = Path(directory) / name
            if path in private_env_files or path.is_symlink():
                continue
            content = path.read_bytes()
            rules = detect(content, secrets, APPROVED_FIXTURES.get(path.relative_to(ROOT).as_posix(), ()))
            files += 1
            if rules:
                findings.append({'scope': 'working/build/artifacts', 'path': path.relative_to(ROOT).as_posix(), 'rules': rules})
    print(json.dumps({'stage': 'working-tree-complete', 'files': files, 'findings': findings}), flush=True)
    # Includes reachable history, reflogs and dangling local objects, without rewriting Git.
    paths = {}
    for line in git('rev-list', '--objects', '--all', '--reflog').decode().splitlines():
        oid, _, path = line.partition(' ')
        if path:
            paths[oid] = path
    process = subprocess.Popen(['git', 'cat-file', '--batch-all-objects', '--batch'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    blobs = 0
    try:
        while header := process.stdout.readline():
            oid, kind, size = header.decode().strip().split()
            content = process.stdout.read(int(size))
            if len(content) != int(size) or process.stdout.read(1) != b'\n':
                raise RuntimeError('Incomplete Git object stream')
            if kind != 'blob':
                continue
            blobs += 1
            rules = detect(content, secrets, APPROVED_FIXTURES.get(paths.get(oid), ()))
            historical_path = paths.get(oid, '')
            if re.search(r'(^|/)\.env($|\.)', historical_path) and not historical_path.endswith('.example'):
                rules.append('historical environment file')
            if rules:
                findings.append({'scope': 'git-object', 'object': oid, 'path': paths.get(oid, '(unreachable or unnamed object)'), 'rules': rules})
        if process.wait() != 0:
            raise RuntimeError('Git object scan failed')
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            process.wait()
    print(json.dumps({'workingFiles': files, 'gitBlobs': blobs, 'privateEnvFilesIgnored': len(private_env_files), 'findings': findings, 'valuesPrinted': False}), flush=True)
    return bool(findings)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        # Exception messages can contain credentials or file contents.
        print('Secret audit could not finish; no credential values were printed.', file=sys.stderr)
        sys.exit(2)
