import { isValidShopPhone } from '@paserve/contracts';

describe('Shop phone validation', () => {
  it.each([
    '',
    '  ',
    '09123456789',
    '+63 912 345 6789',
    '(02) 8123-4567',
    '1234567',
    '123456789012345',
  ])('accepts optional, local or formatted numeric phone %s', (phone) => {
    expect(isValidShopPhone(phone)).toBe(true);
  });
  it.each([
    'call me',
    '123456',
    '1234567890123456',
    '+63 9O12345678',
    '123+456789',
    '(02 8123-4567',
    '02) 8123-4567',
    '++123456789',
    '1234567 ext 8',
    '١٢٣٤٥٦٧',
  ])('rejects invalid numeric phone %s', (phone) => {
    expect(isValidShopPhone(phone)).toBe(false);
  });
});
