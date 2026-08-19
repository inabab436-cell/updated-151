-- =============================================================================
-- CUPAI — approve_product_row: accept per-image visual descriptions.
--
-- Migration 2026-08-05 added product_images.internal_description /
-- visual_features and staging_products.image_internal_descriptions, but the
-- approval RPC was never updated. The server calls the RPC with an extra
-- p_image_descriptions argument, so PostgREST fails with:
--   Could not find the function public.approve_product_row(..., p_image_descriptions, ...)
--
-- This migration adds the 12-argument version (identical behaviour to the
-- 11-argument one, plus copying the per-image payload onto product_images)
-- and drops the stale 11-argument overload so no ambiguity remains.
--
-- p_image_descriptions shape: { "<image url>": { "internal_description": text,
--                                                "visual_features": jsonb } }
-- Safe to re-run.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.approve_product_row(
  p_user_id            uuid,
  p_staging_id         uuid,
  p_fingerprint        uuid,
  p_target_id          uuid,
  p_batch_id           uuid,
  p_product            jsonb,
  p_image_urls         jsonb,
  p_replace_images     boolean,
  p_variants           jsonb,
  p_colors             jsonb,
  p_sizes              jsonb,
  p_image_descriptions jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id           uuid;
  v_desc         text;
  v_desc_hash    text;
  v_desc_status  text;
  v_desc_updated timestamptz;
  v_features     jsonb;
BEGIN
  SELECT internal_description,
         internal_description_hash,
         internal_description_status,
         internal_description_updated_at,
         visual_features
    INTO v_desc, v_desc_hash, v_desc_status, v_desc_updated, v_features
    FROM staging_products
   WHERE id = p_staging_id AND user_id = p_user_id;

  IF p_target_id IS NULL THEN
    INSERT INTO products (
      user_id, batch_id, name, description, category, price, currency,
      variants, images, is_published, published_at,
      internal_description, internal_description_hash,
      internal_description_status, internal_description_updated_at,
      visual_features
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
      NULLIF(p_product->>'published_at','')::timestamptz,
      v_desc, v_desc_hash,
      COALESCE(v_desc_status, 'pending'),
      v_desc_updated,
      v_features
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
      internal_description             = COALESCE(v_desc,         internal_description),
      internal_description_hash        = COALESCE(v_desc_hash,    internal_description_hash),
      internal_description_status      = COALESCE(v_desc_status,  internal_description_status),
      internal_description_updated_at  = COALESCE(v_desc_updated, internal_description_updated_at),
      visual_features                  = COALESCE(v_features,     visual_features),
      updated_at   = now()
    WHERE id = p_target_id AND user_id = p_user_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Product % not found for user %', p_target_id, p_user_id;
    END IF;

    IF p_replace_images THEN
      UPDATE products
         SET internal_description_status = 'stale'
       WHERE id = v_id AND user_id = p_user_id;
    END IF;
  END IF;

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

  IF p_replace_images THEN
    DELETE FROM product_images WHERE product_id = v_id;
    IF jsonb_typeof(p_image_urls) = 'array' AND jsonb_array_length(p_image_urls) > 0 THEN
      INSERT INTO product_images (product_id, user_id, url, position)
      SELECT v_id, p_user_id, elem, (ord - 1)::int
        FROM jsonb_array_elements_text(p_image_urls) WITH ORDINALITY AS t(elem, ord);
    END IF;
  END IF;

  -- Per-image visual descriptions produced during the review stage.
  IF p_image_descriptions IS NOT NULL
     AND jsonb_typeof(p_image_descriptions) = 'object' THEN
    UPDATE product_images pi SET
      internal_description = COALESCE(
        NULLIF(d.value->>'internal_description',''), pi.internal_description),
      visual_features = COALESCE(
        CASE WHEN jsonb_typeof(d.value->'visual_features') = 'null'
             THEN NULL ELSE d.value->'visual_features' END,
        pi.visual_features)
      FROM jsonb_each(p_image_descriptions) AS d(key, value)
     WHERE pi.product_id = v_id AND pi.url = d.key;
  END IF;

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

-- Remove the stale 11-argument overload (no caller uses it anymore).
DROP FUNCTION IF EXISTS public.approve_product_row(
  uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, boolean, jsonb, jsonb, jsonb
);

COMMIT;

-- PostgREST schema cache refresh (so the new signature is visible at once).
NOTIFY pgrst, 'reload schema';
