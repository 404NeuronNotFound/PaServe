CREATE FUNCTION public.broadcast_order_preparing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD."preparationStatus" = 'QUEUED' AND NEW."preparationStatus" = 'PREPARING'
     AND NEW.status = 'CONFIRMED' AND NEW."paymentStatus" = 'PAID'
     AND NEW."queuedAt" IS NOT NULL AND NEW."preparationStartedAt" >= NEW."queuedAt"
     AND NEW."preparationStartedBy" IS NOT NULL THEN
    PERFORM realtime.send(jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_preparing', 'staff:preparation:' || NEW."shopId", true);
    -- Reuse existing authorized receipt/cashier connections for status changes.
    PERFORM realtime.send(jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_preparing', 'staff:confirmed:' || NEW."shopId", true);
    PERFORM realtime.send(jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_preparing', 'customer:confirmed:' || NEW."shopId" || ':' || NEW.id, true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_order_preparing() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER orders_broadcast_preparing AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.broadcast_order_preparing();

-- Existing confirmation policies protect the other two namespaces.
CREATE POLICY preparing_order_backend_only ON realtime.messages
AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (topic NOT LIKE 'staff:preparation:%')
WITH CHECK (topic NOT LIKE 'staff:preparation:%');
