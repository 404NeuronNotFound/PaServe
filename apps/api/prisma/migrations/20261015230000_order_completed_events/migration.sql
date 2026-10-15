CREATE FUNCTION public.broadcast_order_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD."preparationStatus" = 'READY' AND NEW."preparationStatus" = 'COMPLETED'
     AND NEW.status = 'CONFIRMED' AND NEW."paymentStatus" = 'PAID'
     AND NEW."queuedAt" IS NOT NULL AND NEW."preparationStartedAt" >= NEW."queuedAt"
     AND NEW."preparationStartedBy" IS NOT NULL
     AND NEW."preparationReadyAt" >= NEW."preparationStartedAt"
     AND NEW."preparationReadyBy" IS NOT NULL
     AND NEW."completedAt" >= NEW."preparationReadyAt" AND NEW."completedBy" IS NOT NULL THEN
    PERFORM realtime.send(jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_completed', 'staff:preparation:' || NEW."shopId", true);
    PERFORM realtime.send(jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_completed', 'staff:confirmed:' || NEW."shopId", true);
    PERFORM realtime.send(jsonb_build_object('shopId', NEW."shopId", 'orderId', NEW.id),
      'order_completed', 'customer:confirmed:' || NEW."shopId" || ':' || NEW.id, true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_order_completed() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER orders_broadcast_completed AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.broadcast_order_completed();
-- The existing confirmation/preparation policies protect these private topics.
