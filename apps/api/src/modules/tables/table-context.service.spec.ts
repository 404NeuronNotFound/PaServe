import { ConfigService } from '@nestjs/config';
import {
  TableContextService,
  TABLE_CONTEXT_SECONDS,
} from './table-context.service.js';
const service = () =>
  new TableContextService(
    new ConfigService({ JWT_ACCESS_SECRET: 'a'.repeat(64) }),
  );
describe('signed table context', () => {
  afterEach(() => vi.useRealTimers());
  it('binds the token to exactly one shop and table', () => {
    const contexts = service();
    const token = contexts.issue('cafe', 'T12');
    expect(() => contexts.verify(token, 'cafe', 'T12')).not.toThrow();
    expect(() => contexts.verify(token, 'other', 'T12')).toThrow();
    expect(() => contexts.verify(token, 'cafe', 'T13')).toThrow();
  });
  it('rejects tampering and signatures created with another key', () => {
    const contexts = service();
    const token = contexts.issue('cafe', 'T12');
    const [payload, signature] = token.split('.');
    const claims = {
      ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
      code: 'T13',
    };
    expect(() =>
      contexts.verify(
        `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`,
        'cafe',
        'T13',
      ),
    ).toThrow();
    const other = new TableContextService(
      new ConfigService({ JWT_ACCESS_SECRET: 'b'.repeat(64) }),
    );
    expect(() => other.verify(token, 'cafe', 'T12')).toThrow();
  });
  it('expires after four hours and accepts a newly resolved token', () => {
    vi.useFakeTimers();
    const contexts = service();
    const token = contexts.issue('cafe', 'T12');
    vi.advanceTimersByTime(TABLE_CONTEXT_SECONDS * 1000);
    expect(() => contexts.verify(token, 'cafe', 'T12')).toThrow();
    expect(() =>
      contexts.verify(contexts.issue('cafe', 'T12'), 'cafe', 'T12'),
    ).not.toThrow();
  });
  it.each(['', 'x', 'a.a', 'x'.repeat(1025), null, undefined])(
    'fails closed for malformed token %j',
    (token) => {
      expect(() => service().verify(token as string, 'cafe', 'T12')).toThrow();
    },
  );
  it('does not accept an auth JWT as a table context', () => {
    expect(() =>
      service().verify(
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature',
        'cafe',
        'T12',
      ),
    ).toThrow();
  });
});
