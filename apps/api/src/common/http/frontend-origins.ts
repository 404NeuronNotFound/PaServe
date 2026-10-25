/** One allowlist for credentialed CORS and cookie-authentication origin checks. */
export function frontendOrigins(
  value: string | undefined,
  production: boolean,
): string[] {
  if (value === undefined && !production) return ['http://localhost:5173'];
  const invalid = () =>
    new Error(
      'FRONTEND_ORIGINS must contain explicit HTTP(S) origins; production requires non-loopback HTTPS origins.',
    );
  if (!value?.trim()) throw invalid();
  const entries = value.split(',').map((entry) => {
    const raw = entry.trim();
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw invalid();
    }
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    const loopback =
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      ['[::1]', '[::]', '0.0.0.0'].includes(host) ||
      host.startsWith('127.') ||
      /^\[::ffff:(?:7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)\]$/u.test(host);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      raw.includes('*') ||
      /[\\\s]/u.test(raw) ||
      (production && (url.protocol !== 'https:' || loopback))
    ) {
      throw invalid();
    }
    // Reject noncanonical spellings that browsers would never send as Origin.
    if (raw !== url.origin && raw !== `${url.origin}/`) throw invalid();
    return url.origin;
  });
  return [...new Set(entries)];
}
