/** A successful child alone cannot certify cleanup or a complete load run. */
export function finalizeLoadReport(report, state) {
  const pass =
    report?.pass === true &&
    state.workloadSucceeded === true &&
    state.postgresStopped === true &&
    state.ownedDirectoryRemoved === true &&
    (!state.requiresDatabaseLog || state.databaseLogs?.pass === true);
  return {
    ...report,
    pass,
    status: pass ? 'complete' : 'failed',
    cleanup: {
      postgresStopped: state.postgresStopped === true,
      ownedDirectoryRemoved: state.ownedDirectoryRemoved === true,
    },
  };
}
