BEGIN;

-- 169 has already been applied. Keep its payment ledger and leave its historical votes intact.
ALTER TABLE public.next_season_bmc_payments
  ADD COLUMN bmc_created_at timestamptz,
  ADD COLUMN last_item_event_at timestamptz,
  ADD COLUMN claimed_manager_id bigint CHECK (claimed_manager_id > 0),
  ADD COLUMN claimed_at timestamptz;

CREATE TABLE public.next_season_bmc_items (
  payment_id bigint NOT NULL REFERENCES public.next_season_bmc_payments(payment_id),
  item_id bigint NOT NULL CHECK (item_id IN (599984, 599987, 599986, 599982)),
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  euro_cents integer NOT NULL CHECK (euro_cents > 0),
  PRIMARY KEY (payment_id, item_id)
);

ALTER TABLE public.next_season_bmc_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.next_season_bmc_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.next_season_bmc_items TO service_role;

CREATE TABLE public.next_season_bmc_returns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id bigint NOT NULL CHECK (item_id IN (599984, 599987, 599986, 599982)),
  manager_id bigint NOT NULL CHECK (manager_id > 0),
  manager_name text NOT NULL CHECK (length(manager_name) BETWEEN 1 AND 60),
  returned_at timestamptz NOT NULL DEFAULT now(),
  claimed_payment_id bigint REFERENCES public.next_season_bmc_payments(payment_id)
);

CREATE INDEX next_season_bmc_returns_pending_idx
  ON public.next_season_bmc_returns(item_id, returned_at)
  WHERE claimed_payment_id IS NULL;

ALTER TABLE public.next_season_bmc_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.next_season_bmc_returns FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.next_season_bmc_returns TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.next_season_bmc_returns_id_seq TO service_role;

CREATE FUNCTION public.match_next_season_bmc_returns(p_item_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  candidate record;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(p_item_id);
  FOR candidate IN
    SELECT payment.payment_id, pending.id AS return_id,
      pending.manager_id, pending.manager_name
    FROM public.next_season_bmc_payments AS payment
    JOIN public.next_season_bmc_items AS item ON item.payment_id = payment.payment_id
    JOIN public.next_season_bmc_returns AS pending ON pending.item_id = item.item_id
    WHERE item.item_id = p_item_id AND NOT payment.refunded
      AND payment.claimed_manager_id IS NULL AND pending.claimed_payment_id IS NULL
      AND payment.bmc_created_at BETWEEN pending.returned_at - interval '20 minutes'
        AND pending.returned_at + interval '1 minute'
    ORDER BY abs(extract(epoch FROM pending.returned_at - payment.bmc_created_at)), pending.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.next_season_bmc_returns
      WHERE id = candidate.return_id AND claimed_payment_id IS NULL) THEN CONTINUE; END IF;
    UPDATE public.next_season_bmc_payments
      SET claimed_manager_id = candidate.manager_id,
        claimed_at = now(), public_name = candidate.manager_name, updated_at = now()
      WHERE payment_id = candidate.payment_id AND claimed_manager_id IS NULL AND NOT refunded;
    IF FOUND THEN
      UPDATE public.next_season_bmc_returns
        SET claimed_payment_id = candidate.payment_id WHERE id = candidate.return_id;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.record_next_season_bmc_order(
  p_payment_id bigint,
  p_refunded boolean,
  p_bmc_created_at timestamptz,
  p_event_at timestamptz,
  p_items jsonb
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_last_item_event_at timestamptz;
  v_item record;
BEGIN
  IF p_payment_id IS NULL OR p_payment_id <= 0 OR p_refunded IS NULL
    OR p_bmc_created_at IS NULL OR p_event_at IS NULL
    OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Invalid BMC order';
  END IF;

  -- Use the same lock order as return claims before touching payment rows.
  FOR v_item IN SELECT DISTINCT item_id
    FROM jsonb_to_recordset(p_items) AS item(item_id bigint)
    WHERE item_id IN (599984, 599987, 599986, 599982)
    ORDER BY item_id LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(v_item.item_id);
  END LOOP;

  INSERT INTO public.next_season_bmc_payments
    (payment_id, refunded, bmc_created_at)
  VALUES (p_payment_id, p_refunded, p_bmc_created_at)
  ON CONFLICT (payment_id) DO UPDATE SET
    refunded = public.next_season_bmc_payments.refunded OR EXCLUDED.refunded,
    bmc_created_at = COALESCE(public.next_season_bmc_payments.bmc_created_at, EXCLUDED.bmc_created_at),
    public_name = CASE WHEN public.next_season_bmc_payments.refunded OR EXCLUDED.refunded
      THEN NULL ELSE public.next_season_bmc_payments.public_name END,
    claimed_manager_id = CASE WHEN public.next_season_bmc_payments.refunded OR EXCLUDED.refunded
      THEN NULL ELSE public.next_season_bmc_payments.claimed_manager_id END,
    updated_at = now();

  SELECT last_item_event_at INTO v_last_item_event_at
  FROM public.next_season_bmc_payments WHERE payment_id = p_payment_id FOR UPDATE;

  IF jsonb_array_length(p_items) > 0 AND
    (v_last_item_event_at IS NULL OR p_event_at >= v_last_item_event_at) THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_items) AS item(item_id bigint, quantity integer, euro_cents integer)
      WHERE item.item_id NOT IN (599984, 599987, 599986, 599982)
        OR item.quantity NOT BETWEEN 1 AND 1000 OR item.euro_cents <= 0
    ) THEN
      RAISE EXCEPTION 'Invalid BMC item';
    END IF;
    DELETE FROM public.next_season_bmc_items WHERE payment_id = p_payment_id;
    INSERT INTO public.next_season_bmc_items (payment_id, item_id, quantity, euro_cents)
    SELECT p_payment_id, item_id, quantity, euro_cents
    FROM jsonb_to_recordset(p_items) AS item(item_id bigint, quantity integer, euro_cents integer);
    UPDATE public.next_season_bmc_payments
      SET last_item_event_at = p_event_at WHERE payment_id = p_payment_id;
  END IF;

  IF NOT p_refunded AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT item_id FROM public.next_season_bmc_items
      WHERE payment_id = p_payment_id LOOP
      PERFORM public.match_next_season_bmc_returns(v_item.item_id);
    END LOOP;
  END IF;
END;
$$;

CREATE FUNCTION public.claim_next_season_bmc_order(
  p_item_id bigint, p_manager_id bigint, p_manager_name text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_return_id bigint;
  v_matched boolean;
BEGIN
  IF p_item_id NOT IN (599984, 599987, 599986, 599982)
    OR p_manager_id IS NULL OR p_manager_id <= 0
    OR p_manager_name IS NULL OR length(trim(p_manager_name)) NOT BETWEEN 1 AND 60 THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(p_item_id);
  SELECT id INTO v_return_id FROM public.next_season_bmc_returns
  WHERE item_id = p_item_id AND manager_id = p_manager_id
    AND claimed_payment_id IS NULL
    AND returned_at > now() - interval '20 minutes'
  ORDER BY returned_at DESC LIMIT 1;
  IF v_return_id IS NULL THEN
    INSERT INTO public.next_season_bmc_returns (item_id, manager_id, manager_name)
    VALUES (p_item_id, p_manager_id, trim(p_manager_name)) RETURNING id INTO v_return_id;
  END IF;
  PERFORM public.match_next_season_bmc_returns(p_item_id);
  SELECT claimed_payment_id IS NOT NULL INTO v_matched
  FROM public.next_season_bmc_returns WHERE id = v_return_id;
  RETURN COALESCE(v_matched, false);
END;
$$;

CREATE FUNCTION public.next_season_fundraiser_summary()
RETURNS TABLE(item_id bigint, quantity bigint, euro_cents bigint, supporters text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT item.item_id, sum(item.quantity), sum(item.quantity::bigint * item.euro_cents)::bigint,
    COALESCE(array_agg(DISTINCT payment.public_name ORDER BY payment.public_name)
      FILTER (WHERE payment.public_name IS NOT NULL), ARRAY[]::text[])
  FROM public.next_season_bmc_items AS item
  JOIN public.next_season_bmc_payments AS payment ON payment.payment_id = item.payment_id
  WHERE NOT payment.refunded
  GROUP BY item.item_id;
$$;

REVOKE ALL ON FUNCTION public.match_next_season_bmc_returns(bigint),
  public.record_next_season_bmc_order(bigint,boolean,timestamptz,timestamptz,jsonb),
  public.claim_next_season_bmc_order(bigint,bigint,text),
  public.next_season_fundraiser_summary()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_next_season_bmc_returns(bigint),
  public.record_next_season_bmc_order(bigint,boolean,timestamptz,timestamptz,jsonb),
  public.claim_next_season_bmc_order(bigint,bigint,text),
  public.next_season_fundraiser_summary()
  TO service_role;

COMMIT;

-- applied!