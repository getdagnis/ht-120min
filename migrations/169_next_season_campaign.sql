BEGIN;

CREATE TABLE public.next_season_votes (
  campaign_key text NOT NULL,
  hattrick_user_id bigint NOT NULL CHECK (hattrick_user_id > 0),
  choices text[] NOT NULL DEFAULT '{}',
  responded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_key, hattrick_user_id),
  CHECK (campaign_key = 'next-season-2026'),
  CHECK (cardinality(choices) <= 4 AND choices <@ ARRAY['exotic_hfi', 'flag_hunters', 'one_twenty', 'bone_crushers']::text[])
);

CREATE TABLE public.next_season_bmc_payments (
  payment_id bigint PRIMARY KEY CHECK (payment_id > 0),
  refunded boolean NOT NULL DEFAULT false,
  public_name text CHECK (public_name IS NULL OR (length(public_name) BETWEEN 1 AND 60)),
  name_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT refunded OR public_name IS NULL)
);

ALTER TABLE public.next_season_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.next_season_bmc_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.next_season_votes, public.next_season_bmc_payments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.next_season_votes, public.next_season_bmc_payments TO service_role;

CREATE FUNCTION public.next_season_counts(p_campaign_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'exotic_hfi', count(*) FILTER (WHERE 'exotic_hfi' = ANY(choices)),
    'flag_hunters', count(*) FILTER (WHERE 'flag_hunters' = ANY(choices)),
    'one_twenty', count(*) FILTER (WHERE 'one_twenty' = ANY(choices)),
    'bone_crushers', count(*) FILTER (WHERE 'bone_crushers' = ANY(choices))
  ) FROM public.next_season_votes WHERE campaign_key = p_campaign_key;
$$;

CREATE FUNCTION public.record_next_season_bmc_payment(
  p_payment_id bigint, p_refunded boolean, p_public_name text
) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  INSERT INTO public.next_season_bmc_payments (payment_id, refunded, public_name)
  VALUES (p_payment_id, p_refunded,
    CASE WHEN p_refunded THEN NULL ELSE p_public_name END)
  ON CONFLICT (payment_id) DO UPDATE SET
    refunded = public.next_season_bmc_payments.refunded OR EXCLUDED.refunded,
    public_name = CASE WHEN public.next_season_bmc_payments.refunded OR EXCLUDED.refunded
      THEN NULL WHEN public.next_season_bmc_payments.name_locked
      THEN public.next_season_bmc_payments.public_name ELSE EXCLUDED.public_name END,
    updated_at = now();
$$;

REVOKE ALL ON FUNCTION public.next_season_counts(text),
  public.record_next_season_bmc_payment(bigint,boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_season_counts(text),
  public.record_next_season_bmc_payment(bigint,boolean,text)
  TO service_role;

COMMIT;

-- applied!