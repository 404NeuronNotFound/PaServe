import { latencySloPolicy } from './latency-slo.mjs';

const entries = [];
function add(method, route, category, p95Ms, p99Ms, boundary = 'api-complete-body') {
  entries.push(Object.freeze({ method, route: `/api/v1/${route}`, category, p95Ms, p99Ms,
    maximumErrorRate: latencySloPolicy.maximumErrorRate, boundary,
    scope: 'MVP normal valid traffic; target definition, not measured attainment' }));
}
const read = (method, route, category = 'protected-read') => add(method, route, category, 500, 1000);
const write = (route, category = 'staff-write') => add('POST', route, category, 2000, 4000);
for (const name of ['login', 'register', 'refresh']) add('POST', `auth/${name}`, 'authentication', 1000, 1500);
read('POST', 'auth/logout', 'session'); read('GET', 'auth/me', 'session');
read('PATCH', 'auth/profile', 'account');
for (const name of ['email', 'password']) write(`auth/${name}`, 'account-credential-write');
for (const route of ['menu/:shopSlug', 'menu/:shopSlug/table/:tableCode', 'menu/:shopSlug/products/:productId']) read('GET', route, 'public-read');
read('POST', 'menu/:shopSlug/products/:productId/quote', 'live-quote');
add('POST', 'menu/:shopSlug/orders', 'order-create', 2000, 4000, 'logical-order-result');
for (const route of ['status', 'tracking-link']) read('GET', `menu/:shopSlug/orders/:orderId/${route}`, 'order-tracking');
read('POST', 'menu/:shopSlug/orders/:orderId/tracking-session', 'order-tracking');
const orders = 'shops/:shopId/orders';
for (const route of ['active', 'completed', 'cancelled', ':orderId/details', ':orderId/cashier-review', ':orderId/cash-payment']) read('GET', `${orders}/${route}`);
for (const route of ['lookup-number', 'scan-qr', ':orderId/verify-qr', 'cashier-review/lookup-number', 'cash-payment/lookup-number']) read('POST', `${orders}/${route}`, 'staff-verification');
for (const route of [':orderId/confirm-number', ':orderId/reject-number', ':orderId/confirm', ':orderId/reject']) write(`${orders}/${route}`, 'order-decision');
for (const route of [':orderId/create-payment', ':orderId/other-payment', ':orderId/card-manual-payment', ':orderId/gcash-manual-payment', ':orderId/cash-payment']) write(`${orders}/${route}`, 'payment-write');
for (const route of [':orderId/start-preparing', ':orderId/mark-ready', ':orderId/complete']) write(`${orders}/${route}`, 'preparation-write');
for (const route of ['completed', 'ready', 'queue', 'preparing']) read('GET', `shops/:shopId/preparation/${route}`, 'kitchen-read');
for (const route of ['sales-trends', 'average-prep-time', 'peak-hours', 'top-products', 'custom-sales', 'monthly-analytics', 'weekly-analytics', 'daily-analytics', 'daily-sales', 'completed-sales'])
  add('GET', `shops/:shopId/reports/${route}`, 'analytics-read', 1000, 1500);
add('GET', 'health/live', 'liveness', 100, 250);
add('GET', 'health', 'database-readiness', 1000, 1500);

export const criticalEndpointSloPolicy = Object.freeze({ version: 1, maximumErrorRate: latencySloPolicy.maximumErrorRate,
  minimumP95Samples: latencySloPolicy.minimumP95Samples, minimumP99Samples: latencySloPolicy.minimumP99Samples,
  minimumObservationSeconds: latencySloPolicy.minimumObservationSeconds, endpoints: Object.freeze(entries),
  notes: Object.freeze(['Error budgets count failed/missed normal valid attempts, including unintended 429/503. Negative controls and hostile saturation are separate cohorts.',
    'Write attempt HTTP failures/conflicts must be recorded separately from eventual logical workflow success; never conceal retries.',
    'SSE is a stream: use the separate realtime commit-to-authorized-client targets, not the duration of an open connection.',
    'Signatures, authorization and secure password hashing remain inside endpoint work; interactive CAPTCHA solving is outside server timing.',
    'The route catalog extends explicit budget coverage without claiming new measurements or changing the historical latency policy v2.']) });

export function criticalEndpointMarkdown() {
  return `# Critical endpoint MVP latency/error targets\n\nCatalog v${criticalEndpointSloPolicy.version}. These are targets for normal valid traffic, not a deployment SLA or proof of measured attainment.\n\n| Method | Route | Category | p95 ms | p99 ms | Maximum error rate | Boundary |\n| --- | --- | --- | ---: | ---: | ---: | --- |\n${entries.map((row) => `| ${row.method} | \`${row.route}\` | ${row.category} | ${row.p95Ms} | ${row.p99Ms} | ${row.maximumErrorRate * 100}% | ${row.boundary} |`).join('\n')}\n\n${criticalEndpointSloPolicy.notes.map((note) => `- ${note}`).join('\n')}\n\nRequire at least ${criticalEndpointSloPolicy.minimumP95Samples} successful samples for p95, ${criticalEndpointSloPolicy.minimumP99Samples} for p99, and ${criticalEndpointSloPolicy.minimumObservationSeconds} seconds of observation. Small cohorts remain insufficient for SLO attainment. See [latency policy](latency-slo-targets.md) for cache/browser/DB/realtime goals.\n`;
}
