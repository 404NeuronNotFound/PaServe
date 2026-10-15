-- Publish workflow entry, not every order update. The message insert belongs
-- to the order transaction: a rollback cannot announce an eligible order.
CREATE FUNCTION public.broadcast_new_order_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workflow text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'PENDING_CONFIRMATION'
     AND NEW."paymentStatus" = 'UNPAID' AND NEW."preparationStatus" IS NULL THEN
    workflow := 'cashier';
  ELSIF NEW.status = 'CONFIRMED' AND NEW."paymentStatus" = 'PAID'
     AND NEW."preparationStatus" = 'QUEUED' AND NEW."queuedAt" IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      workflow := 'kitchen';
    ELSIF OLD.status IS DISTINCT FROM 'CONFIRMED'
       OR OLD."paymentStatus" IS DISTINCT FROM 'PAID'
       OR OLD."preparationStatus" IS DISTINCT FROM 'QUEUED' THEN
      workflow := 'kitchen';
    END IF;
  END IF;
  IF workflow IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('shopId', NEW."shopId", 'workflow', workflow),
      'new_order', 'staff:new-order:' || NEW."shopId" || ':' || workflow, true
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_new_order_workflow() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER orders_broadcast_new_workflow
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.broadcast_new_order_workflow();

-- Deliberately no browser realtime.messages policies or order-table grants.
-- Only the backend service role subscribes; NestJS authorizes each recipient.
-- Restrictive policies also keep these topics closed if another feature later
-- introduces a permissive Broadcast policy. service_role bypasses RLS.
CREATE POLICY staff_new_order_backend_only ON realtime.messages
AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (topic NOT LIKE 'staff:new-order:%')
WITH CHECK (topic NOT LIKE 'staff:new-order:%');
