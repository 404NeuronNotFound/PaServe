// Private fork only: disconnect stops traffic if the owning API fixture dies.
import { runOrderSearchLoad } from '../../../scripts/order-search-load.mjs';
import { runMixedRamp } from './load-ramp.client-workload.mjs';
if (!process.send) throw new Error('Use the managed load environment.');
process.once('disconnect', () => process.exit(1));
const run =
  process.env.LOAD_FIXTURE_RAMP === '1' ? runMixedRamp : runOrderSearchLoad;
run(process.env, {
  onStage: (stage) =>
    new Promise((resolve, reject) => {
      process.send({ type: 'stage', stage }, (error) =>
        error ? reject(error) : resolve(),
      );
    }),
}).then(
  (report) => {
    process.send({ type: 'complete', report }, () => process.exit(0));
  },
  () => {
    process.send({ type: 'failed' }, () => process.exit(1));
  },
);
