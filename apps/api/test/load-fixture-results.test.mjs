import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeLoadReport } from './load-fixture-results.mjs';
const clean = {
  workloadSucceeded: true,
  postgresStopped: true,
  ownedDirectoryRemoved: true,
};
await test('a passing load must include successful owned-cluster cleanup', () => {
  assert.equal(finalizeLoadReport({ pass: true }, clean).status, 'complete');
  for (const flag of Object.keys(clean)) {
    const result = finalizeLoadReport(
      { pass: true },
      { ...clean, [flag]: false },
    );
    assert.equal(result.pass, false, flag);
    assert.equal(result.status, 'failed', flag);
  }
});
await test('missing or malformed child verdicts cannot become a complete report', () => {
  for (const pass of [undefined, null, false, 'true', 'false', 1]) {
    assert.equal(finalizeLoadReport({ pass }, clean).pass, false);
  }
});
await test('soak log failure remains fatal despite passing traffic and cleanup', () => {
  for (const databaseLogs of [undefined, { pass: false }, { pass: 'true' }]) {
    assert.equal(
      finalizeLoadReport(
        { pass: true },
        { ...clean, requiresDatabaseLog: true, databaseLogs },
      ).pass,
      false,
    );
  }
  assert.equal(
    finalizeLoadReport(
      { pass: true },
      { ...clean, requiresDatabaseLog: true, databaseLogs: { pass: true } },
    ).pass,
    true,
  );
});
