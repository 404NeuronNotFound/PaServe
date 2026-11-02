-- Private, ephemeral, HMAC-keyed admission metadata. No addresses or tokens.
CREATE TABLE public.security_state (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  hits integer NOT NULL DEFAULT 0,
  expires timestamptz NOT NULL,
  arrivals timestamptz[] NOT NULL DEFAULT '{}'
);
CREATE INDEX security_state_expiry ON public.security_state(expires);
ALTER TABLE public.security_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_state FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.paserve_security_state(p_key text, p_op text, p_ttl integer, p_limit integer)
RETURNS TABLE(hits integer, retry integer, accepted boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
  entry public.security_state%ROWTYPE;
  moment timestamptz;
  lifetime interval;
  times timestamptz[];
BEGIN
  IF p_key !~ '^[a-f0-9]{64}$' OR p_op NOT IN ('read','hit','rate','reserve','delete')
     OR p_ttl < 1 OR p_ttl > 900000 OR p_limit < 1 OR p_limit > 6000 THEN
    RAISE EXCEPTION 'Invalid security operation';
  END IF;
  -- Every operation on a key, including reads/deletes/reservations, is serialized.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key, 72814));
  moment := clock_timestamp();
  lifetime := p_ttl * interval '1 millisecond';
  SELECT * INTO entry FROM public.security_state s WHERE s.key = p_key;
  IF entry.expires <= moment THEN
    DELETE FROM public.security_state s WHERE s.key = p_key;
    entry := NULL;
  END IF;
  IF p_op = 'delete' THEN
    DELETE FROM public.security_state s WHERE s.key = p_key;
    RETURN QUERY SELECT 0, 0, true;
    RETURN;
  END IF;
  IF p_op = 'read' THEN
    RETURN QUERY SELECT COALESCE(entry.hits, 0), COALESCE(ceil(extract(epoch FROM entry.expires - moment))::integer, 0), true;
    RETURN;
  END IF;
  IF entry.key IS NULL THEN
    -- Bound identities without evicting active protection. Serialize only new keys.
    PERFORM pg_advisory_xact_lock(72814, 1);
    DELETE FROM public.security_state s WHERE s.key IN (
      SELECT old.key FROM public.security_state old WHERE old.expires <= moment LIMIT 256 FOR UPDATE SKIP LOCKED
    );
    IF (SELECT count(*) FROM public.security_state) >= 50000 THEN
      RAISE EXCEPTION 'Security state capacity reached';
    END IF;
    INSERT INTO public.security_state(key, hits, expires) VALUES (p_key, 0, moment + lifetime)
      RETURNING * INTO entry;
  END IF;
  IF p_op = 'reserve' AND entry.hits > 0 THEN
    RETURN QUERY SELECT entry.hits, greatest(1, ceil(extract(epoch FROM entry.expires - moment))::integer), false;
    RETURN;
  END IF;
  IF p_op = 'rate' THEN
    SELECT COALESCE(array_agg(t ORDER BY t), '{}'::timestamptz[]) INTO times
      FROM unnest(entry.arrivals) t WHERE t > moment - lifetime;
    IF cardinality(times) >= p_limit THEN
      RETURN QUERY SELECT cardinality(times) + 1, greatest(1, ceil(extract(epoch FROM times[1] + lifetime - moment))::integer), false;
      RETURN;
    END IF;
    times := array_append(times, moment);
    UPDATE public.security_state s SET arrivals = times, hits = cardinality(times), expires = moment + lifetime WHERE s.key = p_key;
    RETURN QUERY SELECT cardinality(times), greatest(1, ceil(extract(epoch FROM times[1] + lifetime - moment))::integer), true;
  ELSE
    UPDATE public.security_state s SET hits = least(entry.hits + 1, p_limit) WHERE s.key = p_key;
    RETURN QUERY SELECT least(entry.hits + 1, p_limit), greatest(1, ceil(extract(epoch FROM entry.expires - moment))::integer), true;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.paserve_security_state(text,text,integer,integer) FROM PUBLIC, anon, authenticated;
