import { AuthService } from './auth.service.js';
import type { AuthRepository } from './auth.repository.js';
import type { TokensService } from './tokens.service.js';
import type { PasswordHashService } from './password-hash.service.js';
import { requestContext } from '../../common/http/request-context.js';

describe('cancelled auth native work', () => {
  it.each(['login', 'register'] as const)(
    'does not begin a %s persistence write after cancelled native work completes',
    async (operation) => {
      let finish!: () => void;
      const cancelled = new AbortController();
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const repository = {
        findLoginAccount: vi
          .fn()
          .mockResolvedValue({
            id: 'fixture',
            isActive: true,
            passwordHash: 'fixture-digest',
          }),
        createAccount: vi.fn(),
        createSession: vi.fn(),
      };
      const tokens = { issue: vi.fn() };
      const passwords = {
        dummyHash: vi.fn().mockResolvedValue('fixture-digest'),
        verify: vi.fn(async () => {
          await pending;
          return true;
        }),
        hash: vi.fn(async () => {
          await pending;
          return 'fixture-digest';
        }),
      };
      const auth = new AuthService(
        repository as unknown as AuthRepository,
        tokens as unknown as TokensService,
        passwords as unknown as PasswordHashService,
      );
      const result = requestContext.run({ signal: cancelled.signal }, () =>
        auth[operation]({
          email: 'fixture@example.invalid',
          password: 'fixture-only-password',
        }),
      );
      // Allow login lookup to reach its expensive verification before aborting.
      await new Promise<void>((resolve) => setImmediate(resolve));
      cancelled.abort(new Error('fixture cancellation'));
      finish();
      await expect(result).rejects.toThrow('fixture cancellation');
      expect(repository.createAccount).not.toHaveBeenCalled();
      expect(repository.createSession).not.toHaveBeenCalled();
      expect(tokens.issue).not.toHaveBeenCalled();
    },
  );
});
