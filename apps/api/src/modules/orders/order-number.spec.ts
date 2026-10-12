import { formatOrderNumber } from './order-number.js';

it.each([
  [1n, 'ORD-000001'],
  [999999n, 'ORD-999999'],
  [1000000n, 'ORD-1000000'],
  [9223372036854775807n, 'ORD-9223372036854775807'],
] as const)(
  'formats the shop sequence %s without truncation or number precision loss',
  (sequence, number) => {
    expect(formatOrderNumber(sequence)).toBe(number);
  },
);
it.each([0n, -1n, 9223372036854775808n])(
  'rejects an invalid sequence %s',
  (sequence) => {
    expect(() => formatOrderNumber(sequence)).toThrow();
  },
);
