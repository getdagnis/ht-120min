-- Versioned UI copy. Only server-side service-role code reads or writes these tables.
CREATE TABLE public.locale_catalog_settings (
  locale text PRIMARY KEY CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  native_name text NOT NULL CHECK (length(trim(native_name)) BETWEEN 1 AND 80),
  status text NOT NULL CHECK (status IN ('implemented', 'beta', 'draft')),
  CONSTRAINT english_remains_public CHECK (locale <> 'en' OR status = 'implemented'),
  editor_ht_ids bigint[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.locale_catalog_sections (
  locale text NOT NULL REFERENCES public.locale_catalog_settings(locale),
  section text NOT NULL,
  draft_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(draft_values) = 'object'),
  draft_revision integer NOT NULL DEFAULT 0,
  published_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(published_values) = 'object'),
  published_version integer NOT NULL DEFAULT 0,
  published_at timestamptz,
  published_by bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (locale, section)
);

CREATE TABLE public.locale_catalog_history (
  locale text NOT NULL,
  section text NOT NULL,
  version integer NOT NULL,
  catalog_values jsonb NOT NULL CHECK (jsonb_typeof(catalog_values) = 'object'),
  author_ht_id bigint NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (locale, section, version),
  FOREIGN KEY (locale, section) REFERENCES public.locale_catalog_sections(locale, section)
);

ALTER TABLE public.locale_catalog_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locale_catalog_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locale_catalog_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locale_catalog_settings, public.locale_catalog_sections, public.locale_catalog_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locale_catalog_settings, public.locale_catalog_sections, public.locale_catalog_history TO service_role;

INSERT INTO public.locale_catalog_settings (locale, native_name, status)
VALUES ('en', 'English', 'implemented'), ('lv', 'Letiņvalodā', 'implemented');

-- A single transaction publishes a section and records its immutable revision.
CREATE FUNCTION public.publish_locale_catalog_section(
  p_locale text, p_section text, p_expected_draft_revision integer, p_author_ht_id bigint
) RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  next_version integer;
BEGIN
  UPDATE public.locale_catalog_sections
  SET published_values = draft_values,
      published_version = published_version + 1,
      published_at = now(),
      published_by = p_author_ht_id,
      updated_at = now()
  WHERE locale = p_locale AND section = p_section AND draft_revision = p_expected_draft_revision
  RETURNING published_version INTO next_version;

  IF next_version IS NULL THEN
    RAISE EXCEPTION 'Locale draft changed; reload before publishing.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.locale_catalog_history (locale, section, version, catalog_values, author_ht_id)
  SELECT locale, section, published_version, published_values, p_author_ht_id
  FROM public.locale_catalog_sections
  WHERE locale = p_locale AND section = p_section;
  RETURN next_version;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_locale_catalog_section(text, text, integer, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_locale_catalog_section(text, text, integer, bigint) TO service_role;

-- applied!