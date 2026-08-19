-- =====================================================================
--  Approval write phase: real per-item Postgres transactions.
--
--  Each RPC below performs ALL writes for a single staging item inside
--  its own PL/pgSQL function invocation. Postgres wraps every function
--  call in one implicit transaction, so if any statement RAISEs, every
--  write that function made rolls back automatically — no partial data
--  can remain. TypeScript no longer needs compensating deletes.
--
--  These RPCs deliberately do NOT run AI, matching, or merge logic.
--  The caller pre-computes the final desired state (merged variants,
--  image list, colors, sizes, merged policy content, …) and passes it
--  in as JSON. Fingerprint semantics are unchanged: the caller supplies
--  it and it is stamped onto the staging row alongside status='approved'.
--
--  Run this migration once. Idempotent (CREATE OR REPLACE).
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- PRODUCTS
-- ---------------------------------------------------------------------
-- Drop the pre-per-image-description signature so the new parameter does
-- not create a second overload.
DROP FUNCTION IF EXISTS public.approve_product_row(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, boolean, jsonb, jsonb, jsonb
);

CREATE OR REPLACE FUNCTION public.approve_product_row(
  p_user_id        uuid,
  p_staging_id     uuid,
  p_fingerprint    uuid,
  p_target_id      uuid,       -- null => INSERT new product
  p_batch_id       uuid,
  p_product        jsonb,      -- final column values (patch semantics on UPDATE)
  p_image_urls     jsonb,      -- text[] as jsonb; used only when p_replace_images = true
  p_replace_images boolean,    -- true => DELETE product_images + INSERT p_image_urls
  p_variants       jsonb,      -- canonical [{color,size,price,stock,position}]; always fully replaces product_variants
  p_colors         jsonb,      -- null => leave product_colors untouched; else full replace
  p_sizes          jsonb,      -- null => leave product_sizes untouched;  else full replace
  -- Per-image internal visual descriptions, keyed by the SAME storage url
  -- strings passed in p_image_urls:
  --   { "<url>": { "internal_description": text, "visual_features": jsonb } }
  -- Only consumed when p_replace_images = true. Any url with no entry keeps
  -- NULL in both columns.
  p_image_descriptions jsonb DEFAULT '{}'::jsonb
) RETURNS uuid

LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_target_id IS NULL THEN
    INSERT INTO products (
      user_id, batch_id, name, description, category, price, currency,
      variants, images, is_published, published_at
    ) VALUES (
      p_user_id,
      p_batch_id,
      p_product->>'name',
      p_product->>'description',
      p_product->>'category',
      NULLIF(p_product->>'price','')::numeric,
      p_product->>'currency',
      COALESCE(p_product->'variants','[]'::jsonb),
      COALESCE(p_product->'images','[]'::jsonb),
      COALESCE((p_product->>'is_published')::boolean, false),
      NULLIF(p_product->>'published_at','')::timestamptz
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE products SET
      name         = CASE WHEN p_product ? 'name'         THEN p_product->>'name'         ELSE name         END,
      description  = CASE WHEN p_product ? 'description'  THEN p_product->>'description'  ELSE description  END,
      category     = CASE WHEN p_product ? 'category'     THEN p_product->>'category'     ELSE category     END,
      price        = CASE WHEN p_product ? 'price'        THEN NULLIF(p_product->>'price','')::numeric ELSE price END,
      currency     = CASE WHEN p_product ? 'currency'     THEN p_product->>'currency'     ELSE currency     END,
      variants     = CASE WHEN p_product ? 'variants'     THEN COALESCE(p_product->'variants','[]'::jsonb) ELSE variants END,
      images       = CASE WHEN p_product ? 'images'       THEN COALESCE(p_product->'images','[]'::jsonb)   ELSE images   END,
      is_published = CASE WHEN p_product ? 'is_published' THEN (p_product->>'is_published')::boolean       ELSE is_published END,
      published_at = CASE WHEN p_product ? 'published_at' THEN NULLIF(p_product->>'published_at','')::timestamptz ELSE published_at END,
      updated_at   = now()
    WHERE id = p_target_id AND user_id = p_user_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Product % not found for user %', p_target_id, p_user_id;
    END IF;
  END IF;

  -- product_variants: always full replace (matches current syncVariantsForProduct behaviour).
  DELETE FROM product_variants WHERE product_id = v_id;
  IF jsonb_typeof(p_variants) = 'array' AND jsonb_array_length(p_variants) > 0 THEN
    INSERT INTO product_variants (product_id, color, size, price, stock, position)
    SELECT v_id,
           NULLIF(v->>'color',''),
           NULLIF(v->>'size',''),
           NULLIF(v->>'price','')::numeric,
           NULLIF(v->>'stock','')::int,
           COALESCE(NULLIF(v->>'position','')::int, 0)
      FROM jsonb_array_elements(p_variants) AS v;
  END IF;

  -- product_images: only touched when caller asked for replacement.
  IF p_replace_images THEN
    DELETE FROM product_images WHERE product_id = v_id;
    IF jsonb_typeof(p_image_urls) = 'array' AND jsonb_array_length(p_image_urls) > 0 THEN
      -- Each row also receives the accurate internal visual description that
      -- was generated for THAT exact image, looked up by its url key. Images
      -- without a description keep NULL in both columns.
      INSERT INTO product_images (
        product_id, user_id, url, position, internal_description, visual_features
      )
      SELECT v_id, p_user_id, t.elem, (t.ord - 1)::int,
             NULLIF(COALESCE(p_image_descriptions, '{}'::jsonb) #>> ARRAY[t.elem, 'internal_description'], ''),
             COALESCE(p_image_descriptions, '{}'::jsonb) #> ARRAY[t.elem, 'visual_features']
        FROM jsonb_array_elements_text(p_image_urls) WITH ORDINALITY AS t(elem, ord);
    END IF;

  END IF;

  -- product_colors / product_sizes: null => leave alone; array => full replace.
  IF p_colors IS NOT NULL AND jsonb_typeof(p_colors) = 'array' THEN
    DELETE FROM product_colors WHERE product_id = v_id;
    IF jsonb_array_length(p_colors) > 0 THEN
      INSERT INTO product_colors (product_id, user_id, label, hex, position)
      SELECT v_id, p_user_id,
             c->>'label',
             NULLIF(c->>'hex',''),
             COALESCE(NULLIF(c->>'position','')::int, 0)
        FROM jsonb_array_elements(p_colors) AS c
       WHERE c ? 'label' AND (c->>'label') <> '';
    END IF;
  END IF;

  IF p_sizes IS NOT NULL AND jsonb_typeof(p_sizes) = 'array' THEN
    DELETE FROM product_sizes WHERE product_id = v_id;
    IF jsonb_array_length(p_sizes) > 0 THEN
      INSERT INTO product_sizes (product_id, user_id, label, position)
      SELECT v_id, p_user_id,
             s->>'label',
             COALESCE(NULLIF(s->>'position','')::int, 0)
        FROM jsonb_array_elements(p_sizes) AS s
       WHERE s ? 'label' AND (s->>'label') <> '';
    END IF;
  END IF;

  UPDATE staging_products SET
    status = 'approved',
    processing_fingerprint = p_fingerprint,
    failure_reason = NULL,
    failed_at = NULL
  WHERE id = p_staging_id AND user_id = p_user_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_product_row(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, boolean, jsonb, jsonb, jsonb, jsonb
) TO service_role;

-- ---------------------------------------------------------------------
-- Skip-only variant: mark a product staging row approved with no writes
-- to the products graph. Kept as its own function so the caller always
-- goes through an RPC (single implicit transaction).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_product_skip(
  p_user_id     uuid,
  p_staging_id  uuid,
  p_fingerprint uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE staging_products SET
    status = 'approved',
    processing_fingerprint = p_fingerprint,
    failure_reason = NULL,
    failed_at = NULL
  WHERE id = p_staging_id AND user_id = p_user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_product_skip(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------
-- POLICIES  (single row, no children)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_policy_row(
  p_user_id     uuid,
  p_staging_id  uuid,
  p_fingerprint uuid,
  p_target_id   uuid,        -- null => INSERT
  p_payload     jsonb        -- {kind,title,content,is_published,published_at}
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_target_id IS NULL THEN
    INSERT INTO policies (
      user_id, kind, title, content, is_published, published_at
    ) VALUES (
      p_user_id,
      p_payload->>'kind',
      p_payload->>'title',
      p_payload->>'content',
      COALESCE((p_payload->>'is_published')::boolean, false),
      NULLIF(p_payload->>'published_at','')::timestamptz
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE policies SET
      kind         = CASE WHEN p_payload ? 'kind'         THEN p_payload->>'kind'    ELSE kind         END,
      title        = CASE WHEN p_payload ? 'title'        THEN p_payload->>'title'   ELSE title        END,
      content      = CASE WHEN p_payload ? 'content'      THEN p_payload->>'content' ELSE content      END,
      is_published = CASE WHEN p_payload ? 'is_published' THEN (p_payload->>'is_published')::boolean ELSE is_published END,
      published_at = CASE WHEN p_payload ? 'published_at' THEN NULLIF(p_payload->>'published_at','')::timestamptz ELSE published_at END,
      updated_at   = now()
    WHERE id = p_target_id AND user_id = p_user_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Policy % not found for user %', p_target_id, p_user_id;
    END IF;
  END IF;

  UPDATE staging_policies SET
    status = 'approved',
    processing_fingerprint = p_fingerprint,
    failure_reason = NULL,
    failed_at = NULL
  WHERE id = p_staging_id AND user_id = p_user_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.approve_policy_skip(
  p_user_id uuid, p_staging_id uuid, p_fingerprint uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE staging_policies SET
    status='approved', processing_fingerprint=p_fingerprint,
    failure_reason=NULL, failed_at=NULL
  WHERE id=p_staging_id AND user_id=p_user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_policy_row(uuid,uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_policy_skip(uuid,uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------
-- SHIPPING
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_shipping_row(
  p_user_id     uuid,
  p_staging_id  uuid,
  p_fingerprint uuid,
  p_target_id   uuid,
  p_payload     jsonb        -- {country,region,price,currency,eta,notes,is_published,published_at}
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_target_id IS NULL THEN
    INSERT INTO shipping_rates (
      user_id, country, region, price, currency, eta, notes,
      is_published, published_at
    ) VALUES (
      p_user_id,
      p_payload->>'country',
      p_payload->>'region',
      NULLIF(p_payload->>'price','')::numeric,
      p_payload->>'currency',
      p_payload->>'eta',
      p_payload->>'notes',
      COALESCE((p_payload->>'is_published')::boolean, false),
      NULLIF(p_payload->>'published_at','')::timestamptz
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE shipping_rates SET
      country      = CASE WHEN p_payload ? 'country'  THEN p_payload->>'country'  ELSE country  END,
      region       = CASE WHEN p_payload ? 'region'   THEN p_payload->>'region'   ELSE region   END,
      price        = CASE WHEN p_payload ? 'price'    THEN NULLIF(p_payload->>'price','')::numeric ELSE price END,
      currency     = CASE WHEN p_payload ? 'currency' THEN p_payload->>'currency' ELSE currency END,
      eta          = CASE WHEN p_payload ? 'eta'      THEN p_payload->>'eta'      ELSE eta      END,
      notes        = CASE WHEN p_payload ? 'notes'    THEN p_payload->>'notes'    ELSE notes    END,
      is_published = CASE WHEN p_payload ? 'is_published' THEN (p_payload->>'is_published')::boolean ELSE is_published END,
      published_at = CASE WHEN p_payload ? 'published_at' THEN NULLIF(p_payload->>'published_at','')::timestamptz ELSE published_at END,
      updated_at   = now()
    WHERE id = p_target_id AND user_id = p_user_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Shipping rate % not found for user %', p_target_id, p_user_id;
    END IF;
  END IF;

  UPDATE staging_shipping SET
    status='approved', processing_fingerprint=p_fingerprint,
    failure_reason=NULL, failed_at=NULL
  WHERE id=p_staging_id AND user_id=p_user_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.approve_shipping_skip(
  p_user_id uuid, p_staging_id uuid, p_fingerprint uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE staging_shipping SET
    status='approved', processing_fingerprint=p_fingerprint,
    failure_reason=NULL, failed_at=NULL
  WHERE id=p_staging_id AND user_id=p_user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_shipping_row(uuid,uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_shipping_skip(uuid,uuid,uuid) TO service_role;

-- ---------------------------------------------------------------------
-- CONTACTS
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_contact_row(
  p_user_id     uuid,
  p_staging_id  uuid,
  p_fingerprint uuid,
  p_target_id   uuid,
  p_payload     jsonb        -- {kind,label,value,is_published,published_at}
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_target_id IS NULL THEN
    INSERT INTO contact_info (
      user_id, kind, label, value, is_published, published_at
    ) VALUES (
      p_user_id,
      p_payload->>'kind',
      p_payload->>'label',
      p_payload->>'value',
      COALESCE((p_payload->>'is_published')::boolean, false),
      NULLIF(p_payload->>'published_at','')::timestamptz
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE contact_info SET
      kind         = CASE WHEN p_payload ? 'kind'  THEN p_payload->>'kind'  ELSE kind  END,
      label        = CASE WHEN p_payload ? 'label' THEN p_payload->>'label' ELSE label END,
      value        = CASE WHEN p_payload ? 'value' THEN p_payload->>'value' ELSE value END,
      is_published = CASE WHEN p_payload ? 'is_published' THEN (p_payload->>'is_published')::boolean ELSE is_published END,
      published_at = CASE WHEN p_payload ? 'published_at' THEN NULLIF(p_payload->>'published_at','')::timestamptz ELSE published_at END,
      updated_at   = now()
    WHERE id = p_target_id AND user_id = p_user_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Contact % not found for user %', p_target_id, p_user_id;
    END IF;
  END IF;

  UPDATE staging_contacts SET
    status='approved', processing_fingerprint=p_fingerprint,
    failure_reason=NULL, failed_at=NULL
  WHERE id=p_staging_id AND user_id=p_user_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.approve_contact_skip(
  p_user_id uuid, p_staging_id uuid, p_fingerprint uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE staging_contacts SET
    status='approved', processing_fingerprint=p_fingerprint,
    failure_reason=NULL, failed_at=NULL
  WHERE id=p_staging_id AND user_id=p_user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_contact_row(uuid,uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_contact_skip(uuid,uuid,uuid) TO service_role;

COMMIT;
