import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Exercise the exact policy in a rollback-only transaction, including the
// presence of a permissive policy. No business rows or migration history change.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const shop = randomUUID(),
  other = randomUUID(),
  order = randomUUID();
const topics = [
  `staff:new-order:${shop}:cashier`,
  `staff:new-order:${shop}:kitchen`,
  `staff:confirmed:${shop}`,
  `staff:preparation:${shop}`,
  `customer:confirmed:${shop}:${order}`,
  `menu:availability:${shop}:fixture-menu`,
  `staff:future:${other}`,
  `customer:future:${other}`,
];
const unrelated = `unrelated:${randomUUID()}`;
try {
  await db.connect();
  await db.query('BEGIN');
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20261016020000_realtime_channel_authorization/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const exists = await db.query(
    "SELECT 1 FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname='app_realtime_backend_only'",
  );
  await db.query(
    exists.rowCount ? sql.slice(0, sql.indexOf('CREATE POLICY')) : sql,
  );
  for (const topic of [...topics, unrelated]) {
    await db.query(
      `INSERT INTO realtime.messages(topic,event,payload,private,extension) VALUES($1,'fixture','{}',true,'broadcast')`,
      [topic],
    );
  }
  await db.query('CREATE TEMP TABLE realtime_write_probe(id text)');
  for (const role of ['anon', 'authenticated']) {
    await db.query(`GRANT USAGE ON SCHEMA realtime TO ${role}`);
    await db.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON realtime.messages TO ${role}`,
    );
    await db.query(
      `CREATE POLICY fixture_realtime_${role} ON realtime.messages FOR ALL TO ${role} USING(true) WITH CHECK(true)`,
    );
    await db.query(`SET LOCAL ROLE ${role}`);
    assert.equal(
      Number(
        (
          await db.query(
            'SELECT count(*) n FROM realtime.messages WHERE topic=ANY($1::text[])',
            [topics],
          )
        ).rows[0].n,
      ),
      0,
    );
    for (const statement of [
      `UPDATE realtime.messages SET payload='{"spoof":true}' WHERE topic=ANY($1::text[])`,
      'DELETE FROM realtime.messages WHERE topic=ANY($1::text[])',
    ]) {
      await db.query('SAVEPOINT mutate');
      try {
        assert.equal((await db.query(statement, [topics])).rowCount, 0);
      } catch (error) {
        assert.equal(error.code, '42501');
        await db.query('ROLLBACK TO SAVEPOINT mutate');
      }
      await db.query('RELEASE SAVEPOINT mutate');
    }
    assert.equal(
      Number(
        (
          await db.query(
            'SELECT count(*) n FROM realtime.messages WHERE topic=$1',
            [unrelated],
          )
        ).rows[0].n,
      ),
      1,
      'Unrelated namespaces retain their independent policies',
    );
    // Installed realtime.send catches publication failures. Verify that its
    // failed RLS insert does not abort an otherwise valid transaction.
    await db.query('RESET ROLE');
    await db.query(
      `GRANT SELECT,INSERT ON pg_temp.realtime_write_probe TO ${role}`,
    );
    await db.query(`SET LOCAL ROLE ${role}`);
    await db.query('INSERT INTO pg_temp.realtime_write_probe VALUES($1)', [
      `${role}-before`,
    ]);
    await db.query("SELECT realtime.send('{}'::jsonb,'fixture',$1,true)", [
      topics[0],
    ]);
    await db.query('INSERT INTO pg_temp.realtime_write_probe VALUES($1)', [
      `${role}-after`,
    ]);
    assert.equal(
      Number(
        (await db.query('SELECT count(*) n FROM pg_temp.realtime_write_probe'))
          .rows[0].n,
      ),
      role === 'anon' ? 2 : 4,
    );
    await db.query('RESET ROLE');
    for (const topic of topics) {
      await db.query('SAVEPOINT publish');
      await db.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(
        db.query(
          `INSERT INTO realtime.messages(topic,event,payload,private,extension) VALUES($1,'fixture','{}',true,'broadcast')`,
          [topic],
        ),
        (e) => e.code === '42501',
      );
      await db.query('ROLLBACK TO SAVEPOINT publish');
      await db.query('RESET ROLE');
    }
  }
  assert.equal(
    Number(
      (
        await db.query(
          'SELECT count(*) n FROM realtime.messages WHERE topic=ANY($1::text[])',
          [topics],
        )
      ).rows[0].n,
    ),
    topics.length,
    'Backend visibility is intact',
  );
  await db.query('ROLLBACK');
  assert.equal(
    Number(
      (
        await db.query(
          'SELECT count(*) n FROM realtime.messages WHERE topic=ANY($1::text[])',
          [[...topics, unrelated]],
        )
      ).rows[0].n,
    ),
    0,
  );
  console.log(
    'Passed: RLS enabled; all staff, customer, menu, and future reserved topics deny anon/authenticated receive/publish/update/delete despite permissive policies. Failed publication does not abort a valid temporary transaction. Backend and unrelated policies preserved. All fixtures rolled back.',
  );
} finally {
  await db.query('ROLLBACK').catch(() => undefined);
  await db.end();
}
