-- LLM Usage tracking table
CREATE TABLE public.llm_usage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- User/Project context
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,

    -- Request details
    provider text NOT NULL CHECK (provider IN ('claude', 'codex', 'codebuff', 'opencode')),
    model text NOT NULL,

    -- Token counts
    input_tokens integer NOT NULL DEFAULT 0,
    output_tokens integer NOT NULL DEFAULT 0,

    -- Cost (in USD, stored as decimal for precision)
    cost_usd numeric(10, 6) NOT NULL DEFAULT 0,

    -- Request metadata
    session_token_id text,
    request_id text,

    -- Timing
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    duration_ms integer,

    -- Status
    status text NOT NULL DEFAULT 'completed'
        CHECK (status IN ('pending', 'completed', 'failed', 'canceled')),
    error_message text,

    -- Metadata (for debugging/auditing)
    metadata jsonb DEFAULT '{}',

    created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX llm_usage_user_id_idx ON public.llm_usage(user_id);
CREATE INDEX llm_usage_project_id_idx ON public.llm_usage(project_id);
CREATE INDEX llm_usage_user_created_idx ON public.llm_usage(user_id, created_at DESC);
CREATE INDEX llm_usage_provider_idx ON public.llm_usage(provider);
CREATE INDEX llm_usage_created_at_idx ON public.llm_usage(created_at DESC);

-- RLS policies
ALTER TABLE public.llm_usage ENABLE ROW LEVEL SECURITY;

-- Users can view their own usage
CREATE POLICY "Users can view own usage"
    ON public.llm_usage FOR SELECT
    USING (auth.uid() = user_id);

-- Service role can insert (used by agent-service)
CREATE POLICY "Service role can insert usage"
    ON public.llm_usage FOR INSERT
    WITH CHECK (true);

-- Aggregation view for billing/analytics
CREATE VIEW public.llm_usage_summary AS
SELECT
    user_id,
    date_trunc('month', created_at) as month,
    provider,
    COUNT(*) as request_count,
    SUM(input_tokens) as total_input_tokens,
    SUM(output_tokens) as total_output_tokens,
    SUM(cost_usd) as total_cost_usd
FROM public.llm_usage
WHERE status = 'completed'
GROUP BY user_id, date_trunc('month', created_at), provider;
