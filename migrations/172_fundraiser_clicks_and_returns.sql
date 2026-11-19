BEGIN;

CREATE TABLE public.fundraiser_clicks (
  id uuid PRIMARY KEY,
  item_id bigint NOT NULL CHECK (item_id IN (599984, 599987, 599986, 599982)),
  manager_id bigint CHECK (manager_id > 0),
  clicked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fundraiser_clicks_manager_item_time_idx
  ON public.fundraiser_clicks(manager_id, item_id, clicked_at DESC);
ALTER TABLE public.fundraiser_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fundraiser_clicks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fundraiser_clicks TO service_role;

ALTER TABLE public.next_season_bmc_returns
  ADD COLUMN return_key uuid UNIQUE,
  ADD COLUMN click_id uuid REFERENCES public.fundraiser_clicks(id),
  ADD COLUMN match_method text CHECK (match_method IN ('click', 'timing'));

CREATE OR REPLACE FUNCTION public.match_next_season_bmc_returns(p_item_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE candidate record;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(p_item_id);
  FOR candidate IN
    SELECT payment.payment_id, pending.id AS return_id,
      pending.manager_id, pending.manager_name, pending.click_id
    FROM public.next_season_bmc_payments AS payment
    JOIN public.next_season_bmc_items AS item ON item.payment_id = payment.payment_id
    JOIN public.next_season_bmc_returns AS pending ON pending.item_id = item.item_id
    WHERE item.item_id = p_item_id AND NOT payment.refunded
      AND payment.claimed_manager_id IS NULL AND pending.claimed_payment_id IS NULL
      AND payment.bmc_created_at BETWEEN pending.returned_at - interval '20 minutes'
        AND pending.returned_at + interval '1 minute'
    ORDER BY (pending.click_id IS NOT NULL) DESC,
      (abs(extract(epoch FROM pending.returned_at - payment.bmc_created_at)) <= 120) DESC,
      abs(extract(epoch FROM pending.returned_at - payment.bmc_created_at)), pending.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.next_season_bmc_returns
      WHERE id = candidate.return_id AND claimed_payment_id IS NULL) THEN CONTINUE; END IF;
    UPDATE public.next_season_bmc_payments
      SET claimed_manager_id = candidate.manager_id,
        claimed_at = now(), public_name = candidate.manager_name, updated_at = now()
      WHERE payment_id = candidate.payment_id AND claimed_manager_id IS NULL AND NOT refunded;
    IF FOUND THEN
      UPDATE public.next_season_bmc_returns
        SET claimed_payment_id = candidate.payment_id,
          match_method = CASE WHEN candidate.click_id IS NULL THEN 'timing' ELSE 'click' END
        WHERE id = candidate.return_id AND claimed_payment_id IS NULL;
    END IF;
  END LOOP;
END;
$$;

-- A return key makes refreshes and post-login retries use the original arrival time.
CREATE FUNCTION public.claim_fundraiser_return(
  p_return_key uuid, p_item_id bigint, p_manager_id bigint, p_manager_name text,
  p_returned_at timestamptz, p_click_id uuid
) RETURNS TABLE(matched boolean, method text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_return_id bigint;
  v_click_id uuid;
BEGIN
  IF p_return_key IS NULL OR p_item_id NOT IN (599984, 599987, 599986, 599982)
    OR p_manager_id IS NULL OR p_manager_id <= 0
    OR p_manager_name IS NULL OR length(trim(p_manager_name)) NOT BETWEEN 1 AND 60
    OR p_returned_at IS NULL OR p_returned_at > now() + interval '1 minute'
    OR p_returned_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'Invalid fundraiser return';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(p_item_id);
  SELECT id INTO v_click_id FROM public.fundraiser_clicks
    WHERE item_id = p_item_id AND manager_id = p_manager_id
      AND clicked_at <= p_returned_at AND clicked_at >= p_returned_at - interval '1 day'
    ORDER BY (id = p_click_id) DESC, clicked_at DESC LIMIT 1;
  SELECT id INTO v_return_id FROM public.next_season_bmc_returns
    WHERE return_key = p_return_key AND manager_id = p_manager_id AND item_id = p_item_id;
  IF v_return_id IS NULL THEN
    INSERT INTO public.next_season_bmc_returns
      (return_key, item_id, manager_id, manager_name, returned_at, click_id)
    VALUES (p_return_key, p_item_id, p_manager_id, trim(p_manager_name), p_returned_at, v_click_id)
    ON CONFLICT (return_key) DO NOTHING RETURNING id INTO v_return_id;
  END IF;
  IF v_return_id IS NULL THEN RETURN QUERY SELECT false, NULL::text; RETURN; END IF;
  PERFORM public.match_next_season_bmc_returns(p_item_id);
  RETURN QUERY SELECT payment.payment_id IS NOT NULL, pending.match_method
    FROM public.next_season_bmc_returns AS pending
    LEFT JOIN public.next_season_bmc_payments AS payment
      ON payment.payment_id = pending.claimed_payment_id AND NOT payment.refunded
    WHERE pending.id = v_return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.match_next_season_bmc_returns(bigint),
  public.claim_fundraiser_return(uuid,bigint,bigint,text,timestamptz,uuid),
  public.claim_next_season_bmc_order(bigint,bigint,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_next_season_bmc_returns(bigint),
  public.claim_fundraiser_return(uuid,bigint,bigint,text,timestamptz,uuid)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_next_season_bmc_order(bigint,bigint,text) FROM service_role;

COMMIT;

-- applied!