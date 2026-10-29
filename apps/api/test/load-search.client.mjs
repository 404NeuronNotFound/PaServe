// Private fork only: disconnect stops traffic if the owning API fixture dies.
import { runOrderSearchLoad } from '../../../scripts/order-search-load.mjs';
if (!process.send) throw new Error('Use the managed load environment.');
process.once('disconnect', () => process.exit(1));
runOrderSearchLoad(process.env).then(
  (report) => {
    process.send({ type: 'complete', report }, () => process.exit(0));
  },
  () => {
    process.send({ type: 'failed' }, () => process.exit(1));
  },
);
