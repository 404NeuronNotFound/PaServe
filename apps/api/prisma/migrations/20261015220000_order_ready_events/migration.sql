CREATE FUNCTION public.broadcast_order_ready()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD."preparationStatus" = 'PREPARING' AND NEW."preparationStatus" = 'READY'
     AND NEW.status = 'CONFIRMED' AND NEW."paymentStatus" = 'PAID'
     AND NEW."queuedAt" IS NOT NULL AND NEW."preparationStartedAt" >= NEW."queuedAt"
     AND NEW."preparationStartedBy" IS NOT NULL
     AND NEW."preparationReadyAt" >= NEW."preparationStartedAt"
     AND NEW."preparationReadyBy" IS NOT NULL THEN
    PERFORM realtime.send(jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_ready', 'staff:preparation:' || NEW."shopId", true);
    PERFORM realtime.send(jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_ready', 'staff:confirmed:' || NEW."shopId", true);
    PERFORM realtime.send(jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_ready', 'customer:confirmed:' || NEW."shopId" || ':' || NEW.id, true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_order_ready() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER orders_broadcast_ready AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.broadcast_order_ready();
-- Reuse the restrictive policies installed by confirmation/preparation events.
