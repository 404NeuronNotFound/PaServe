import { fork } from 'node:child_process';
import { operatingSystemEnvironment } from './load-fixture-environment.mjs';

export function runLoadSearchWorker(
  settings,
  { deadlineMs = 60000, onStage = () => {} } = {},
) {
  return new Promise((resolve, reject) => {
    const child = fork(
      new URL('./load-search.client.mjs', import.meta.url),
      [],
      {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...operatingSystemEnvironment(process.env), ...settings },
      },
    );
    let report;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Isolated workload exceeded its deadline.'));
    }, deadlineMs);
    child.on('message', (message) => {
      if (message?.type === 'complete') report = message.report;
      if (message?.type === 'stage') {
        void Promise.resolve()
          .then(() => onStage(message.stage))
          .then(
            () => {
              if (message.id !== undefined && child.connected)
                child.send({ type: 'stage-ack', id: message.id }, (error) => {
                  if (error) {
                    clearTimeout(timer);
                    child.kill();
                    reject(new Error('Stage barrier failed.'));
                  }
                });
            },
            () => {
              clearTimeout(timer);
              child.kill();
              reject(new Error('Stage setup failed.'));
            },
          );
      }
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Isolated workload could not start.'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0 && report) resolve(report);
      else reject(new Error('Isolated workload failed.'));
    });
  });
}
