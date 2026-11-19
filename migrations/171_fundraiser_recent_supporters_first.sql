BEGIN;

CREATE OR REPLACE FUNCTION public.next_season_fundraiser_summary()
RETURNS TABLE(item_id bigint, quantity bigint, euro_cents bigint, supporters text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT item.item_id,
    sum(item.quantity),
    sum(item.quantity::bigint * item.euro_cents)::bigint,
    COALESCE(
      (
        SELECT array_agg(recent.public_name ORDER BY recent.last_support_at DESC, recent.public_name)
        FROM (
          SELECT payment.public_name, max(payment.claimed_at) AS last_support_at
          FROM public.next_season_bmc_items AS supporter_item
          JOIN public.next_season_bmc_payments AS payment
            ON payment.payment_id = supporter_item.payment_id
          WHERE supporter_item.item_id = item.item_id
            AND NOT payment.refunded
            AND payment.public_name IS NOT NULL
          GROUP BY payment.public_name
        ) AS recent
      ),
      ARRAY[]::text[]
    )
  FROM public.next_season_bmc_items AS item
  JOIN public.next_season_bmc_payments AS payment ON payment.payment_id = item.payment_id
  WHERE NOT payment.refunded
  GROUP BY item.item_id;
$$;

REVOKE ALL ON FUNCTION public.next_season_fundraiser_summary()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_season_fundraiser_summary() TO service_role;

COMMIT;
