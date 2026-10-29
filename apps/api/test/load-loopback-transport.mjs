import assert from 'node:assert/strict';
import http from 'node:http';

/** Real socket source addresses, never forwarded-header identities. All callers
 * still use connectLoadTarget() for run/origin/path/expiry proof. */
export function loopbackTransport(input, options = {}) {
  const url = new URL(input);
  assert.ok(
    url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port &&
      !url.username &&
      !url.password,
  );
  const localAddress = options.localAddress ?? '127.0.0.2';
  assert.match(localAddress, /^127\.0\.0\.\d{1,2}$/);
  const octet = Number(localAddress.split('.')[3]);
  assert.ok(octet >= 2 && octet <= 63);
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: options.method ?? 'GET',
        localAddress,
        agent: false,
        headers: Object.fromEntries(new Headers(options.headers).entries()),
        signal: options.signal ?? AbortSignal.timeout(5000),
      },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume();
          reject(
            new Error('Redirects are forbidden in the owned load transport.'),
          );
          return;
        }
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 512 * 1024)
            request.destroy(new Error('Bounded fixture response exceeded.'));
          else chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            for (const item of Array.isArray(value)
              ? value
              : value
                ? [value]
                : [])
              headers.append(key, item);
          resolve(
            new Response(
              [204, 304].includes(response.statusCode)
                ? null
                : Buffer.concat(chunks),
              { status: response.statusCode, headers },
            ),
          );
        });
      },
    );
    request.once('error', reject);
    request.end(options.body);
  });
}
