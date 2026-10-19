import assert from 'node:assert/strict';

// Only call with a generated fixture key. Roll back each probe even if a policy fails.
export async function assertBrowserCannotChangeObject(
  tx,
  bucketId,
  storagePath,
) {
  for (const role of ['anon', 'authenticated']) {
    for (const operation of ['update', 'delete']) {
      await tx.$executeRawUnsafe('SAVEPOINT browser_object_probe');
      try {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        let count;
        try {
          count =
            operation === 'update'
              ? await tx.$executeRaw`UPDATE storage.objects SET name = name WHERE bucket_id = ${bucketId} AND name = ${storagePath}`
              : await tx.$executeRaw`DELETE FROM storage.objects WHERE bucket_id = ${bucketId} AND name = ${storagePath}`;
        } catch (error) {
          assert.equal(
            error.meta?.code ??
              error.meta?.driverAdapterError?.cause?.originalCode,
            '42501',
          );
          continue;
        }
        assert.equal(
          count,
          0,
          `${role} must not ${operation} a storage object`,
        );
      } finally {
        await tx.$executeRawUnsafe(
          'ROLLBACK TO SAVEPOINT browser_object_probe',
        );
      }
    }
  }
}
