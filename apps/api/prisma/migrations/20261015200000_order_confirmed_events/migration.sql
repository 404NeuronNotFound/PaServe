ALTER TABLE public.orders ADD COLUMN "receiptAccessRevokedAt" timestamp(3);
-- Preserve earlier revocation except the expected consumption by confirmation.
-- The NOT VALID payment constraint deliberately retains legacy confirmed/unpaid
-- rows, but PostgreSQL still checks it on any UPDATE of those rows. Preserve its
-- exact definition/validation state while backfilling unrelated receipt metadata.
-- This single statement holds an exclusive lock and restores the constraint
-- before releasing it; any failure rolls back both DDL and the metadata update.
DO $backfill$
DECLARE
  payment_constraint text;
BEGIN
  LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;
  SELECT pg_get_constraintdef(oid) INTO payment_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.orders'::regclass
    AND conname = 'orders_confirmation_requires_payment';
  IF payment_constraint IS NOT NULL THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_confirmation_requires_payment;
  END IF;
  UPDATE public.orders SET "receiptAccessRevokedAt" = "qrTokenRevokedAt"
  WHERE "qrTokenRevokedAt" IS NOT NULL AND NOT (
    status = 'CONFIRMED' AND "paymentStatus" = 'PAID'
    AND "decidedAt" IS NOT NULL AND "qrTokenRevokedAt" = "decidedAt"
  );
  IF payment_constraint IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.orders ADD CONSTRAINT orders_confirmation_requires_payment '
      || payment_constraint;
  END IF;
END;
$backfill$;

CREATE FUNCTION public.broadcast_order_confirmed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'CONFIRMED' AND NEW."paymentStatus" = 'PAID'
     AND NEW."decidedAt" IS NOT NULL AND NEW."paidAt" IS NOT NULL THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'CONFIRMED' AND OLD."paymentStatus" = 'PAID' THEN
        RETURN NEW;
      END IF;
    END IF;
    PERFORM realtime.send(
      jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_confirmed', 'staff:confirmed:' || NEW."shopId", true);
    PERFORM realtime.send(
      jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_confirmed', 'customer:confirmed:' || NEW."shopId" || ':' || NEW.id, true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_order_confirmed() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER orders_broadcast_confirmed AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.broadcast_order_confirmed();

CREATE POLICY confirmed_order_backend_only ON realtime.messages
AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (topic NOT LIKE 'staff:confirmed:%' AND topic NOT LIKE 'customer:confirmed:%')
WITH CHECK (topic NOT LIKE 'staff:confirmed:%' AND topic NOT LIKE 'customer:confirmed:%');
