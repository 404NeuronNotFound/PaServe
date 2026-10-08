import { Test } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import type { CurrentUser } from '@paserve/contracts';
import { AuthService } from '../auth.service.js';
import { invalidSession } from '../tokens.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

describe('JwtAuthGuard', () => {
  const auth = { currentUser: vi.fn() };
  let guard: JwtAuthGuard;
  const user: CurrentUser = {
    id: 'user-id',
    email: 'owner@example.com',
    createdAt: '2026-10-08T00:00:00.000Z',
    firstName: 'Alex',
    lastName: null,
    memberships: [
      {
        id: 'membership-id',
        shopId: 'shop-id',
        role: 'OWNER',
        shop: { id: 'shop-id', name: 'Cafe', slug: 'cafe', isActive: true },
      },
    ],
  };

  function context(authorization?: string) {
    const request: { headers: { authorization?: string }; user?: CurrentUser } =
      {
        headers: { authorization },
      };
    return {
      request,
      execution: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as ExecutionContext,
    };
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [JwtAuthGuard, { provide: AuthService, useValue: auth }],
    }).compile();
    guard = module.get(JwtAuthGuard);
  });

  it.each(['Bearer access-token', 'bearer access-token'])(
    'attaches the verified profile and memberships for %s',
    async (authorization) => {
      auth.currentUser.mockResolvedValue(user);
      const { execution, request } = context(authorization);
      await expect(guard.canActivate(execution)).resolves.toBe(true);
      expect(auth.currentUser).toHaveBeenCalledWith('access-token');
      expect(request.user).toBe(user);
    },
  );

  it.each([
    undefined,
    '',
    'Basic access-token',
    'Bearer',
    'Bearer ',
    'Bearer token extra',
  ])(
    'rejects a missing or malformed Authorization header (%s)',
    async (authorization) => {
      const { execution, request } = context(authorization);
      await expect(guard.canActivate(execution)).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_SESSION' },
      });
      expect(auth.currentUser).not.toHaveBeenCalled();
      expect(request.user).toBeUndefined();
    },
  );

  it('does not allow execution or attach a user when authentication fails', async () => {
    auth.currentUser.mockRejectedValue(invalidSession());
    const { execution, request } = context('Bearer invalid-token');
    await expect(guard.canActivate(execution)).rejects.toMatchObject({
      status: 401,
    });
    expect(request.user).toBeUndefined();
  });

  it('waits for authentication before attaching user context and allowing execution', async () => {
    let authenticate!: (value: CurrentUser) => void;
    auth.currentUser.mockReturnValue(
      new Promise<CurrentUser>((resolve) => {
        authenticate = resolve;
      }),
    );
    const { execution, request } = context('Bearer access-token');
    const result = guard.canActivate(execution);
    expect(request.user).toBeUndefined();
    authenticate(user);
    await expect(result).resolves.toBe(true);
    expect(request.user).toBe(user);
  });
});
