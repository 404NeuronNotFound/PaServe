import {
  canTransitionPreparationStatus,
  type PreparationStatus,
} from '@paserve/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PreparationStartService } from './preparation-start.service.js';
import { PreparationReadyService } from './preparation-ready.service.js';
import { PreparationCompleteService } from './preparation-complete.service.js';

const actorId = '75992537-5d60-4d22-8e1e-60a114644681';
const shopId = '05bcdf9f-d1be-4669-a01c-0b657f5a2f8e';
const orderId = 'e47f6994-a303-4a7b-87b0-2386d5198828';
const states = ['QUEUED', 'PREPARING', 'READY', 'COMPLETED'] as const;
const edges = ['QUEUED:PREPARING', 'PREPARING:READY', 'READY:COMPLETED'];
const actions = [
  {
    name: 'start',
    from: 'QUEUED',
    to: 'PREPARING',
    flag: 'alreadyStarted',
    method: 'start',
  },
  {
    name: 'ready',
    from: 'PREPARING',
    to: 'READY',
    flag: 'alreadyReady',
    method: 'ready',
  },
  {
    name: 'complete',
    from: 'READY',
    to: 'COMPLETED',
    flag: 'alreadyCompleted',
    method: 'complete',
  },
] as const;
type Stored = ReturnType<typeof fixture>;
function fixture(preparationStatus: PreparationStatus | null) {
  const index =
    preparationStatus === null ? -1 : states.indexOf(preparationStatus);
  return {
    id: orderId,
    shopId,
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    totalPrice: '135.50',
    paymentRequestId: '58bb31e6-9c13-4c07-9e04-fbb29b0584ab',
    paidAt: new Date('2026-10-18T23:59:00Z'),
    paidBy: actorId,
    preparationStatus,
    queuedAt: index >= 0 ? new Date('2026-10-19T00:00:00Z') : null,
    preparationStartedAt: index >= 1 ? new Date('2026-10-19T00:01:00Z') : null,
    preparationStartedBy: index >= 1 ? actorId : null,
    preparationReadyAt: index >= 2 ? new Date('2026-10-19T00:02:00Z') : null,
    preparationReadyBy: index >= 2 ? actorId : null,
    completedAt: index >= 3 ? new Date('2026-10-19T00:03:00Z') : null,
    completedBy: index >= 3 ? actorId : null,
  };
}

describe('complete preparation transition policy', () => {
  it.each(states.flatMap((from) => states.map((to) => ({ from, to }))))(
    '$from -> $to has the exact reviewed policy',
    ({ from, to }) => {
      expect(canTransitionPreparationStatus(from, to)).toBe(
        edges.includes(`${from}:${to}`),
      );
    },
  );
});

describe('preparation transitions through real services', () => {
  let saved: Stored;
  const findFirst = vi.fn(),
    updateMany = vi.fn(),
    raw = vi.fn();
  const tx = { order: { findFirst, updateMany }, $queryRaw: raw };
  const transaction = vi.fn();
  const db = { $transaction: transaction } as unknown as PrismaService;
  const services = {
    start: new PreparationStartService(db),
    ready: new PreparationReadyService(db),
    complete: new PreparationCompleteService(db),
  };
  const invoke = (name: keyof typeof services) => {
    if (name === 'start') return services.start.start(actorId, shopId, orderId);
    if (name === 'ready') return services.ready.ready(actorId, shopId, orderId);
    return services.complete.complete(actorId, shopId, orderId);
  };
  beforeEach(() => {
    vi.resetAllMocks();
    saved = fixture('QUEUED');
    transaction.mockImplementation(async (work) => work(tx));
    findFirst.mockImplementation(async () => ({ ...saved }));
    raw.mockResolvedValue([{ now: new Date('2026-10-19T00:05:00Z') }]);
    updateMany.mockImplementation(async ({ where, data }) => {
      // Model a conditional write; missing source predicates are also asserted below.
      for (const key of [
        'id',
        'shopId',
        'status',
        'paymentStatus',
        'preparationStatus',
      ] as const)
        if (where[key] !== saved[key]) return { count: 0 };
      Object.assign(saved, data);
      return { count: 1 };
    });
  });

  const matrix = actions.flatMap((action) =>
    ['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'].flatMap((status) =>
      ['UNPAID', 'PAID'].flatMap((paymentStatus) =>
        [null, ...states].map((preparationStatus) => ({
          ...action,
          status,
          paymentStatus,
          preparationStatus,
        })),
      ),
    ),
  );
  it.each(matrix)(
    '$name from $status/$paymentStatus/$preparationStatus',
    async (test) => {
      saved = {
        ...fixture(test.preparationStatus),
        status: test.status,
        paymentStatus: test.paymentStatus,
      };
      const before = structuredClone(saved);
      const eligible =
        test.status === 'CONFIRMED' && test.paymentStatus === 'PAID';
      if (eligible && test.preparationStatus === test.from) {
        const result = await invoke(test.name);
        expect(result).toMatchObject({
          [test.flag]: false,
          order: { preparationStatus: test.to },
        });
        expect(updateMany).toHaveBeenCalledTimes(1);
        for (const key of [
          'status',
          'paymentStatus',
          'totalPrice',
          'paymentRequestId',
          'paidAt',
          'paidBy',
        ] as const)
          expect(saved[key]).toEqual(before[key]);
        expect(updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: orderId,
              shopId,
              status: 'CONFIRMED',
              paymentStatus: 'PAID',
              preparationStatus: test.from,
              shop: expect.objectContaining({
                id: shopId,
                members: {
                  some: expect.objectContaining({
                    userId: actorId,
                    disabledAt: null,
                  }),
                },
              }),
            }),
          }),
        );
      } else if (eligible && test.preparationStatus === test.to) {
        expect(await invoke(test.name)).toMatchObject({
          [test.flag]: true,
          order: { preparationStatus: test.to },
        });
        expect(saved).toEqual(before);
        expect(updateMany).not.toHaveBeenCalled();
      } else {
        await expect(invoke(test.name)).rejects.toMatchObject({ status: 409 });
        expect(saved).toEqual(before);
        expect(updateMany).not.toHaveBeenCalled();
      }
    },
  );
  it('advances the whole lifecycle with one write per step and immutable replay metadata', async () => {
    for (const action of actions) {
      const first = await invoke(action.name);
      const snapshot = structuredClone(saved);
      const writes = updateMany.mock.calls.length;
      const replay = await invoke(action.name);
      expect(replay).toEqual({ ...first, [action.flag]: true });
      expect(updateMany).toHaveBeenCalledTimes(writes);
      expect(saved).toEqual(snapshot);
    }
    expect(saved.preparationStatus).toBe('COMPLETED');
    expect(updateMany).toHaveBeenCalledTimes(3);
    const completed = structuredClone(saved);
    for (const name of ['start', 'ready'] as const)
      await expect(invoke(name)).rejects.toMatchObject({ status: 409 });
    expect(saved).toEqual(completed);
    expect(updateMany).toHaveBeenCalledTimes(3);
  });
  it.each(actions)('$name refuses a lost conditional write', async (action) => {
    saved = fixture(action.from);
    updateMany.mockResolvedValue({ count: 0 });
    await expect(invoke(action.name)).rejects.toMatchObject({ status: 409 });
    expect(saved.preparationStatus).toBe(action.from);
  });
  it.each(actions)(
    '$name returns 404 for an inaccessible order',
    async (action) => {
      findFirst.mockResolvedValue(null);
      await expect(invoke(action.name)).rejects.toMatchObject({ status: 404 });
      expect(updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(
    actions.flatMap((action) =>
      ['P2034', 'P2002'].map((code) => ({ ...action, code })),
    ),
  )('$name maps transaction conflict $code to 409', async (action) => {
    transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('test conflict', {
        code: action.code,
        clientVersion: 'test',
      }),
    );
    await expect(invoke(action.name)).rejects.toMatchObject({ status: 409 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
