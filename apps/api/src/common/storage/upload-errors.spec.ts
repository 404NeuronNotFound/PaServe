import { isStorageConflict } from './upload-errors.js';
it.each([
  { status: 409 },
  { status: '409' },
  { statusCode: 409 },
  { statusCode: '409' },
])('recognizes an existing-object conflict: %j', (error) => {
  expect(isStorageConflict(error)).toBe(true);
});
it.each([
  undefined,
  null,
  '409',
  new Error('network'),
  { status: 500 },
  { statusCode: '403' },
])(
  'does not mistake other failures for an existing-object conflict: %j',
  (error) => {
    expect(isStorageConflict(error)).toBe(false);
  },
);
