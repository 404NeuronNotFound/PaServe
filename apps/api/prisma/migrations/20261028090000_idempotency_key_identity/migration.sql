BEGIN;

-- UUID letter case must not mint another operation. Preserve historical receipt
-- fields verbatim; fail safely if existing aliases require manual reconciliation.
CREATE UNIQUE INDEX orders_shop_request_id_identity_key
  ON public.orders ("shopId", lower("requestId"));
CREATE UNIQUE INDEX orders_shop_payment_request_id_identity_key
  ON public.orders ("shopId", lower("paymentRequestId"))
  WHERE "paymentRequestId" IS NOT NULL;

COMMIT;
