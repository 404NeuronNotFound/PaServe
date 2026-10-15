ALTER TABLE public.orders ADD COLUMN "receiptAccessRevokedAt" timestamp(3);
-- Preserve earlier revocation except the expected consumption by confirmation.
UPDATE public.orders SET "receiptAccessRevokedAt" = "qrTokenRevokedAt"
WHERE "qrTokenRevokedAt" IS NOT NULL AND NOT (
  status = 'CONFIRMED' AND "paymentStatus" = 'PAID'
  AND "decidedAt" IS NOT NULL AND "qrTokenRevokedAt" = "decidedAt"
);

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
