# Critical endpoint MVP latency/error targets

Catalog v1. These are targets for normal valid traffic, not a deployment SLA or proof of measured attainment.

| Method | Route | Category | p95 ms | p99 ms | Maximum error rate | Boundary |
| --- | --- | --- | ---: | ---: | ---: | --- |
| POST | `/api/v1/auth/login` | authentication | 1000 | 1500 | 0.1% | api-complete-body |
| POST | `/api/v1/auth/register` | authentication | 1000 | 1500 | 0.1% | api-complete-body |
| POST | `/api/v1/auth/refresh` | authentication | 1000 | 1500 | 0.1% | api-complete-body |
| POST | `/api/v1/auth/logout` | session | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/auth/me` | session | 500 | 1000 | 0.1% | api-complete-body |
| PATCH | `/api/v1/auth/profile` | account | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/auth/email` | account-credential-write | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/auth/password` | account-credential-write | 2000 | 4000 | 0.1% | api-complete-body |
| GET | `/api/v1/menu/:shopSlug` | public-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/menu/:shopSlug/table/:tableCode` | public-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/menu/:shopSlug/products/:productId` | public-read | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/menu/:shopSlug/products/:productId/quote` | live-quote | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/menu/:shopSlug/orders` | order-create | 2000 | 4000 | 0.1% | logical-order-result |
| GET | `/api/v1/menu/:shopSlug/orders/:orderId/status` | order-tracking | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/menu/:shopSlug/orders/:orderId/tracking-link` | order-tracking | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/menu/:shopSlug/orders/:orderId/tracking-session` | order-tracking | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/orders/active` | protected-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/orders/completed` | protected-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/orders/cancelled` | protected-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/orders/:orderId/details` | protected-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/orders/:orderId/cashier-review` | protected-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/orders/:orderId/cash-payment` | protected-read | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/lookup-number` | staff-verification | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/scan-qr` | staff-verification | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/verify-qr` | staff-verification | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/cashier-review/lookup-number` | staff-verification | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/cash-payment/lookup-number` | staff-verification | 500 | 1000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/confirm-number` | order-decision | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/reject-number` | order-decision | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/confirm` | order-decision | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/reject` | order-decision | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/create-payment` | payment-write | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/other-payment` | payment-write | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/card-manual-payment` | payment-write | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/gcash-manual-payment` | payment-write | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/cash-payment` | payment-write | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/start-preparing` | preparation-write | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/mark-ready` | preparation-write | 2000 | 4000 | 0.1% | api-complete-body |
| POST | `/api/v1/shops/:shopId/orders/:orderId/complete` | preparation-write | 2000 | 4000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/preparation/completed` | kitchen-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/preparation/ready` | kitchen-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/preparation/queue` | kitchen-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/preparation/preparing` | kitchen-read | 500 | 1000 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/sales-trends` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/average-prep-time` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/peak-hours` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/top-products` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/custom-sales` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/monthly-analytics` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/weekly-analytics` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/daily-analytics` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/daily-sales` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/shops/:shopId/reports/completed-sales` | analytics-read | 1000 | 1500 | 0.1% | api-complete-body |
| GET | `/api/v1/health/live` | liveness | 100 | 250 | 0.1% | api-complete-body |
| GET | `/api/v1/health` | database-readiness | 1000 | 1500 | 0.1% | api-complete-body |

- Error budgets count failed/missed normal valid attempts, including unintended 429/503. Negative controls and hostile saturation are separate cohorts.
- Write attempt HTTP failures/conflicts must be recorded separately from eventual logical workflow success; never conceal retries.
- SSE is a stream: use the separate realtime commit-to-authorized-client targets, not the duration of an open connection.
- Signatures, authorization and secure password hashing remain inside endpoint work; interactive CAPTCHA solving is outside server timing.
- The route catalog extends explicit budget coverage without claiming new measurements or changing the historical latency policy v2.

Require at least 100 successful samples for p95, 1000 for p99, and 60 seconds of observation. Small cohorts remain insufficient for SLO attainment. See [latency policy](latency-slo-targets.md) for cache/browser/DB/realtime goals.
