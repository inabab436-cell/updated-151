-- Customer profile + long-term memory + complaints.
-- Run each section (§A–§D) individually in the Supabase SQL editor.
-- Preserves existing chat/orders/notifications behaviour: no drops, no destructive changes.

-- =============================================================================
-- §A — Extend `customers` for a full profile
-- =============================================================================
ALTER TABLE public.customers ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS visitor_id    text,
  ADD COLUMN IF NOT EXISTS address       text,
  ADD COLUMN IF NOT EXISTS city          text,
  ADD COLUMN IF NOT EXISTS country       text,
  ADD COLUMN IF NOT EXISTS language      text,
  ADD COLUMN IF NOT EXISTS tags          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferences   jsonb  NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes         text,
  ADD COLUMN IF NOT EXISTS total_orders  int    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spent   numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_order_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS customers_merchant_visitor_uidx
  ON public.customers (merchant_id, visitor_id)
  WHERE visitor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_merchant_phone_idx
  ON public.customers (merchant_id, phone);

-- =============================================================================
-- §B — `agent_memory` (long-term memory per customer)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agent_memory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  uuid NOT NULL REFERENCES public.merchants(id)  ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES public.customers(id)  ON DELETE CASCADE,
  key          text NOT NULL,
  value        text NOT NULL,
  importance   smallint NOT NULL DEFAULT 1 CHECK (importance BETWEEN 1 AND 5),
  source       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, key)
);

CREATE INDEX IF NOT EXISTS agent_memory_customer_idx
  ON public.agent_memory (customer_id, importance DESC, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_memory TO authenticated;
GRANT ALL ON public.agent_memory TO service_role;

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_memory owner select" ON public.agent_memory
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.merchants m
                 WHERE m.id = agent_memory.merchant_id AND m.user_id = auth.uid()));

CREATE POLICY "agent_memory owner write" ON public.agent_memory
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.merchants m
                 WHERE m.id = agent_memory.merchant_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.merchants m
                 WHERE m.id = agent_memory.merchant_id AND m.user_id = auth.uid()));

-- =============================================================================
-- §C — `complaints`
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.complaints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     uuid NOT NULL REFERENCES public.merchants(id)     ON DELETE CASCADE,
  customer_id     uuid REFERENCES public.customers(id)              ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id)          ON DELETE SET NULL,
  order_id        uuid REFERENCES public.orders(id)                 ON DELETE SET NULL,
  subject         text,
  description     text NOT NULL,
  category        text,
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','resolved','closed')),
  priority        smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 5),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE INDEX IF NOT EXISTS complaints_merchant_status_idx
  ON public.complaints (merchant_id, status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.complaints TO authenticated;
GRANT ALL ON public.complaints TO service_role;

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "complaints owner select" ON public.complaints
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.merchants m
                 WHERE m.id = complaints.merchant_id AND m.user_id = auth.uid()));

CREATE POLICY "complaints owner write" ON public.complaints
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.merchants m
                 WHERE m.id = complaints.merchant_id AND m.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.merchants m
                 WHERE m.id = complaints.merchant_id AND m.user_id = auth.uid()));

-- =============================================================================
-- §D — Auto-update `updated_at`
-- =============================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_customers_touch    ON public.customers;
DROP TRIGGER IF EXISTS trg_agent_memory_touch ON public.agent_memory;
DROP TRIGGER IF EXISTS trg_complaints_touch   ON public.complaints;

CREATE TRIGGER trg_customers_touch    BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_agent_memory_touch BEFORE UPDATE ON public.agent_memory
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_complaints_touch   BEFORE UPDATE ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();