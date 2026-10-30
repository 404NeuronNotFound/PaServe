import {
  orderBurstProfile,
  orderBurstStages,
  retryableOrder,
} from './order-burst.workload.mjs';

export function evaluateOrderBurst(
  workload,
  monitoring,
  evidence,
  transactions,
) {
  const stages = workload.stages.map((stage, i) => {
    const burst = !['baseline', 'recovery'].includes(stage.phase);
    const expected = stage.phase === 'multi-burst' ? 12 : burst ? 8 : 3;
    const samples = monitoring.samples.filter(
      (s) => s.phase === `order-burst-${stage.phase}`,
    );
    const checks = {
      phase: stage.phase === orderBurstStages[i],
      complete:
        stage.requests === expected &&
        stage.samples.length === expected &&
        stage.samples.every((s) => s.ok && s.status === '201'),
      budgets:
        stage.errorRate === 0 &&
        Number.isFinite(stage.p95Ms) &&
        stage.p95Ms <= orderBurstProfile.p95Ms &&
        Number.isFinite(stage.p99Ms) &&
        stage.p99Ms <= orderBurstProfile.p99Ms,
      simultaneous:
        !burst || stage.launchSpreadMs <= orderBurstProfile.launchSpreadMs,
      uniqueReceipts:
        stage.uniqueReceipts === (stage.phase === 'duplicates' ? 1 : expected),
      critical:
        !burst ||
        (stage.probes.length === 10 &&
          stage.probes.every(
            (p) =>
              p.ok &&
              p.status === '200' &&
              p.ms <= orderBurstProfile.probeBudgetMs,
          ) &&
          ['cashier', 'kitchen'].every((kind) =>
            [0, 2].every(
              (tenant) =>
                [0, 1].every((round) =>
                  stage.probes.some(
                    (p) =>
                      p.kind === kind &&
                      p.tenant === tenant &&
                      p.round === round,
                  ),
                ) &&
                stage.probes.some(
                  (p) =>
                    p.kind === kind &&
                    p.tenant === tenant &&
                    stage.samples.some(
                      (s) =>
                        p.offsetMs < s.offsetMs + s.ms &&
                        p.offsetMs + p.ms > s.offsetMs,
                    ),
                ),
            ),
          ) &&
          [0, 1].every((round) =>
            stage.probes.some((p) => p.kind === 'health' && p.round === round),
          )),
      monitored:
        samples.length >= 2 &&
        samples.every(
          (s) =>
            s.api.pool.total <= s.api.pool.policy.max &&
            s.api.pool.waiting <= s.api.pool.policy.maxWaiting,
        ) &&
        samples
          .slice(1)
          .every((s, j) => s.elapsedMs - samples[j].elapsedMs <= 2000),
    };
    return {
      ...stage,
      checks,
      pass: Object.values(checks).every(Boolean),
      resources: samples.length
        ? {
            samples: samples.length,
            peakCpuCoreEquivalent: Math.max(
              ...samples.map((s) => s.process.cpuCoreEquivalent),
            ),
            peakRssBytes: Math.max(...samples.map((s) => s.process.rssBytes)),
            peakDbConnections: Math.max(
              ...samples.map((s) => s.database.connections),
            ),
            peakPoolWaiting: Math.max(
              ...samples.map((s) => s.api.pool.waiting),
            ),
            peakLockWaiters: Math.max(
              ...samples.map((s) => s.database.lock_waiters),
            ),
          }
        : null,
    };
  });
  const groups = new Map();
  for (const a of workload.attempts) {
    const key = `${a.phase}:${a.client}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const checks = {
    profile:
      JSON.stringify(workload.profile) === JSON.stringify(orderBurstProfile),
    allStages:
      stages.length === orderBurstStages.length && stages.every((s) => s.pass),
    boundedRetries:
      groups.size === 34 &&
      [...groups.values()].every((n) => n <= orderBurstProfile.maxAttempts) &&
      workload.attempts.every(
        (a) =>
          a.status === '201' ||
          (a.status !== 'network_error' && retryableOrder(a.status, a.code)),
      ),
    lostAcknowledgement:
      workload.attempts.filter((a) => a.status === 'simulated_response_loss')
        .length === 1,
    tracking:
      workload.tracking.length === 27 &&
      workload.tracking.every((s) => s.ok && s.status === '200'),
    negativeControls: ['cross-tenant', 'changed-payload'].every((kind) =>
      workload.negativeChecks.some((s) => s.kind === kind && s.ok),
    ),
    databaseAudit: [
      'uniqueRows',
      'uniqueKeys',
      'expectedDistribution',
      'scoped',
      'receiptIntegrity',
      'numbering',
      'noUnacknowledgedWrites',
      'unpaidOnly',
      'negativeProbeNoWrite',
      'noUnexpectedAccounts',
      'sessionCleanup',
      'orderModes',
      'tokenSafety',
    ].every((name) => evidence.checks?.[name] === true),
    monitoring: monitoring.sampleFailures === 0 && !monitoring.truncated,
    sessionCleanup:
      workload.sessionsCreated === orderBurstProfile.staffSessions &&
      workload.sessionsRevoked === orderBurstProfile.staffSessions,
    transactions: validOrderTransactions(transactions, workload),
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    stages,
    evidence,
    transactions,
    profile: orderBurstProfile,
    httpAttempts: workload.attempts.length,
    serializationRetries: workload.attempts.filter(
      (a) => a.code === 'ORDER_RETRY_REQUIRED',
    ).length,
    limitations: [
      'Local fixed 12/8-customer order bursts; not production throughput or breakpoint capacity.',
      'Logical latency includes all bounded retries; HTTP attempt counts and retryable conflicts are retained separately.',
      'Only pending unpaid orders are created; no payment capture, confirmation or hosted realtime delivery is exercised.',
      'Small per-stage samples limit tail-latency certainty; CPU is API/collector only and network counters cover loopback HTTP.',
    ],
  };
}

export function validOrderTransactions(tx, workload) {
  return (
    !!tx &&
    !tx.truncated &&
    tx.attempts === workload.attempts.length + 2 &&
    tx.samples.length === tx.attempts &&
    tx.outcomes.committed ===
      workload.attempts.filter((a) =>
        ['201', 'simulated_response_loss'].includes(a.status),
      ).length &&
    tx.outcomes.conflict ===
      workload.attempts.filter((a) => a.code === 'ORDER_RETRY_REQUIRED')
        .length &&
    tx.outcomes.business_rejection === 2 &&
    tx.outcomes.unexpected_failure === 0 &&
    tx.unexpectedFailureRate === 0 &&
    tx.samples.every(
      (s) =>
        ['durationMs', 'acquisitionMs', 'executionMs'].every(
          (key) => Number.isFinite(s[key]) && s[key] >= 0,
        ) &&
        Math.abs(s.durationMs - s.acquisitionMs - s.executionMs) < 0.01 &&
        orderBurstStages.includes(s.phase.replace('order-burst-', '')),
    ) &&
    orderBurstStages.every((phase) => {
      const summary = tx.phases[`order-burst-${phase}`];
      return (
        summary?.attempts > 0 &&
        ['invocation', 'execution'].every(
          (key) =>
            Number.isFinite(summary[key]?.p95Ms) &&
            summary[key].p95Ms <= orderBurstProfile.p95Ms &&
            Number.isFinite(summary[key]?.p99Ms) &&
            summary[key].p99Ms <= orderBurstProfile.p99Ms,
        )
      );
    })
  );
}

export async function auditOrderBurst(db, fixture, before, records, tokens) {
  const saved = records.filter((r) => r.id),
    unique = [...new Map(saved.map((r) => [r.id, r])).values()];
  const ids = unique.map((r) => r.id);
  const orders =
    // Prisma stores timestamp-without-time-zone values as UTC. pg otherwise
    // interprets them in the host timezone, changing the signed expiry instant.
    (
      await db.query(
        'SELECT *, "qrTokenExpiresAt" AT TIME ZONE \'UTC\' AS "qrTokenExpiresAt" FROM orders WHERE id=ANY($1::text[])',
        [ids],
      )
    ).rows;
  const lines = (
    await db.query(
      'SELECT * FROM order_items WHERE "orderId"=ANY($1::text[]) ORDER BY "orderId","lineNumber"',
      [ids],
    )
  ).rows;
  const totals = (
    await db.query(`SELECT (SELECT count(*)::int FROM orders) orders,(SELECT count(*)::int FROM order_items) lines,
    (SELECT count(*)::int FROM orders WHERE "paymentStatus"='PAID') paid,(SELECT count(*)::int FROM users) users,
    (SELECT count(*)::int FROM auth_sessions) sessions,(SELECT count(*)::int FROM auth_sessions WHERE "revokedAt" IS NOT NULL) revoked`)
  ).rows[0];
  const counts = [];
  let scoped = true,
    receiptIntegrity = true,
    numbering = true;
  for (const [tenant, shop] of fixture.shops.entries()) {
    const expected = unique.filter((r) => r.tenant === tenant),
      owned = orders.filter((o) => o.shopId === shop.shopId);
    const counter = (
      await db.query('SELECT "lastOrderNumber" n FROM shops WHERE id=$1', [
        shop.shopId,
      ])
    ).rows[0].n;
    const expectedNumbers = Array.from({ length: expected.length }, (_, i) =>
      String(before.counters[tenant] + BigInt(i + 1)),
    );
    const actualNumbers = owned
      .map((o) => o.orderNumber.slice(4).replace(/^0+(?=\d)/, ''))
      .sort((a, b) =>
        BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
      );
    numbering &&=
      BigInt(counter) === before.counters[tenant] + BigInt(expected.length) &&
      JSON.stringify(expectedNumbers) === JSON.stringify(actualNumbers);
    counts.push({
      tenant,
      created: owned.length,
      counterAdvance: String(BigInt(counter) - before.counters[tenant]),
    });
    for (const r of expected) {
      const o = owned.find((v) => v.id === r.id);
      scoped &&=
        !!o &&
        o.requestId.toLowerCase() === r.requestId &&
        o.mode === r.mode &&
        o.orderNumber === r.orderNumber;
      if (!o) {
        receiptIntegrity = false;
        continue;
      }
      const items = lines.filter((l) => l.orderId === o.id);
      receiptIntegrity &&=
        o.status === 'PENDING_CONFIRMATION' &&
        o.paymentStatus === 'UNPAID' &&
        o.paidAt === null &&
        o.paymentRequestId === null &&
        o.totalPrice === '37.00' &&
        o.currency === 'PHP' &&
        items.length === 2 &&
        items.every(
          (l) =>
            l.shopId === shop.shopId &&
            l.productId === shop.productId &&
            l.productSnapshotId === shop.productId &&
            l.currency === 'PHP' &&
            l.basePriceSnapshot === '10.00',
        ) &&
        items[0].lineNumber === 1 &&
        items[0].quantity === 2 &&
        items[0].unitPriceSnapshot === '13.50' &&
        items[0].lineTotalSnapshot === '27.00' &&
        items[0].variantsSnapshot.length === 1 &&
        items[0].variantsSnapshot[0].id === shop.variantId &&
        items[0].addOnsSnapshot.length === 1 &&
        items[0].addOnsSnapshot[0].id === shop.addOnId &&
        items[1].lineNumber === 2 &&
        items[1].quantity === 1 &&
        items[1].unitPriceSnapshot === '10.00' &&
        items[1].lineTotalSnapshot === '10.00' &&
        items[1].variantsSnapshot.length === 0 &&
        items[1].addOnsSnapshot.length === 0;
      if (o.mode === 'TAKEOUT')
        scoped &&= o.tableId === null && o.tableCode === null;
      else scoped &&= o.tableId === shop.tableId && o.tableCode === 'T1';
    }
  }
  const invalidIds = records
    .filter((r) => r.invalidRequestId)
    .map((r) => r.invalidRequestId);
  const invalid = (
    await db.query(
      'SELECT count(*)::int n FROM orders WHERE lower("requestId")=ANY($1::text[])',
      [invalidIds],
    )
  ).rows[0].n;
  const keys = new Map();
  for (const r of saved) {
    const key = `${r.tenant}:${r.requestId}`;
    if (!keys.has(key)) keys.set(key, new Set());
    keys.get(key).add(r.id);
  }
  const tokenChecks = auditOrderTokens(tokens, orders, saved);
  tokenChecks.noHistoricalNonceReuse =
    (
      await db.query(
        'SELECT count(*)::int n FROM orders WHERE "qrTokenNonce"=ANY($1::text[])',
        [orders.map((o) => o.qrTokenNonce)],
      )
    ).rows[0].n === 27;
  const checks = {
    tokenSafety: Object.values(tokenChecks).every(Boolean),
    orderModes:
      orders.filter((o) => o.mode === 'DINE_IN').length === 13 &&
      orders.filter((o) => o.mode === 'TAKEOUT').length === 14,
    uniqueRows:
      unique.length === 27 && orders.length === 27 && saved.length === 34,
    uniqueKeys:
      keys.size === 27 && [...keys.values()].every((v) => v.size === 1),
    expectedDistribution:
      JSON.stringify(counts.map((c) => c.created)) ===
      JSON.stringify([15, 6, 6]),
    scoped,
    receiptIntegrity,
    numbering,
    noUnacknowledgedWrites:
      totals.orders - before.orders === 27 &&
      totals.lines - before.lines === 54,
    unpaidOnly: totals.paid === before.paid,
    negativeProbeNoWrite: invalid === 0 && invalidIds.length === 1,
    noUnexpectedAccounts: totals.users === before.users,
    sessionCleanup:
      totals.sessions === orderBurstProfile.staffSessions &&
      totals.revoked === orderBurstProfile.staffSessions,
  };
  return {
    checks,
    tokenChecks,
    uniqueOrders: orders.length,
    orderLines: lines.length,
    tenantCounts: counts,
    dineIn: orders.filter((o) => o.mode === 'DINE_IN').length,
    takeout: orders.filter((o) => o.mode === 'TAKEOUT').length,
  };
}

export function auditOrderTokens(tokens, orders, saved) {
  const checks = {
    uniqueNonces:
      orders.length === 27 &&
      new Set(orders.map((o) => o.qrTokenNonce)).size === 27 &&
      orders.every((o) => /^[0-9a-f-]{36}$/i.test(o.qrTokenNonce)),
    uniqueReceiptTokens: new Set(saved.map((r) => r.qrToken)).size === 27,
    uniqueTrackingTokens:
      new Set(saved.map((r) => r.trackingToken)).size === 27,
    separatePurposes: saved.every(
      (r) => !saved.some((s) => s.trackingToken === r.qrToken),
    ),
    stableReplayTokens: true,
    validBindings: true,
    rejectOtherOrder: true,
    rejectOtherShop: true,
    rejectWrongPurpose: true,
    rejectTampering: true,
  };
  const rejected = (action) => {
    try {
      action();
      return false;
    } catch {
      return true;
    }
  };
  for (const r of saved) {
    const order = orders.find((o) => o.id === r.id);
    if (!order) {
      checks.validBindings = false;
      continue;
    }
    try {
      tokens.verify(r.qrToken, order);
      tokens.verifyTracking(r.trackingToken, order);
      checks.validBindings &&=
        tokens.resolveReference(r.qrToken, order.shopId).orderId === order.id &&
        tokens.resolveTrackingReference(r.trackingToken, order.shopId)
          .orderId === order.id;
      checks.stableReplayTokens &&=
        r.qrToken === tokens.issue(order) &&
        r.trackingToken === tokens.issueTracking(order);
      const other = orders.find(
          (o) => o.id !== order.id && o.shopId === order.shopId,
        ),
        foreign = orders.find((o) => o.shopId !== order.shopId);
      checks.rejectOtherOrder &&=
        !!other &&
        rejected(() => tokens.verify(r.qrToken, other)) &&
        rejected(() => tokens.verifyTracking(r.trackingToken, other));
      checks.rejectOtherShop &&=
        !!foreign &&
        rejected(() => tokens.resolveReference(r.qrToken, foreign.shopId)) &&
        rejected(() =>
          tokens.resolveTrackingReference(r.trackingToken, foreign.shopId),
        );
      checks.rejectWrongPurpose &&=
        rejected(() => tokens.verifyTracking(r.qrToken, order)) &&
        rejected(() => tokens.verify(r.trackingToken, order));
      const tamper = (token) =>
        token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
      checks.rejectTampering &&=
        rejected(() => tokens.verify(tamper(r.qrToken), order)) &&
        rejected(() => tokens.verifyTracking(tamper(r.trackingToken), order));
    } catch {
      checks.validBindings = false;
    }
  }
  if (saved.length !== 34) checks.validBindings = false;
  return checks;
}
