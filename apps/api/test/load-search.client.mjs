// Private fork only: disconnect stops traffic if the owning API fixture dies.
import { runOrderSearchLoad } from '../../../scripts/order-search-load.mjs';
import { runMixedRamp } from './load-ramp.client-workload.mjs';
import { runLoginFlood } from './login-flood.workload.mjs';
import { runMenuSpike } from './menu-spike.workload.mjs';
import { runOrderBurst } from './order-burst.workload.mjs';
import { runTrafficSpike } from './load-spike.workload.mjs';
if (!process.send) throw new Error('Use the managed load environment.');
process.once('disconnect', () => process.exit(1));
const run =
  process.env.LOAD_TRAFFIC_SPIKE === '1'
    ? runTrafficSpike
    : process.env.LOAD_ORDER_BURST === '1'
      ? runOrderBurst
      : process.env.LOAD_MENU_SPIKE === '1'
        ? runMenuSpike
        : process.env.LOAD_LOGIN_FLOOD === '1'
          ? runLoginFlood
          : process.env.LOAD_FIXTURE_RAMP === '1'
            ? runMixedRamp
            : runOrderSearchLoad;
let stageId = 0;
run(process.env, {
  onStage: (stage) =>
    new Promise((resolve, reject) => {
      if (
        process.env.LOAD_MENU_SPIKE !== '1' &&
        process.env.LOAD_TRAFFIC_SPIKE !== '1' &&
        process.env.LOAD_ORDER_BURST !== '1'
      ) {
        process.send({ type: 'stage', stage }, (error) =>
          error ? reject(error) : resolve(),
        );
        return;
      }
      const id = ++stageId;
      const finish = (error) => {
        clearTimeout(timer);
        process.off('message', receive);
        if (error) reject(error);
        else resolve();
      };
      const receive = (message) => {
        if (message?.type === 'stage-ack' && message.id === id) finish();
      };
      const timer = setTimeout(
        () => finish(new Error('Stage barrier timed out.')),
        5000,
      );
      process.on('message', receive);
      process.send({ type: 'stage', stage, id }, (error) => {
        if (error) finish(error);
      });
    }),
}).then(
  (report) => {
    process.send({ type: 'complete', report }, () => process.exit(0));
  },
  () => {
    process.send({ type: 'failed' }, () => process.exit(1));
  },
);
