-- Infrastructure services provisioned for projects
-- This table tracks databases, caches, and other infrastructure services
-- that the agent can provision on demand.

CREATE TABLE public.infra_services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Project context
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

    -- Service identification
    service_type text NOT NULL CHECK (service_type IN ('supabase', 'redis', 'postgres', 'mongodb', 'mysql')),
    name text,

    -- Infrastructure state (Fly.io)
    fly_machine_id text,
    fly_volume_id text,

    -- Status tracking
    status text DEFAULT 'provisioning' NOT NULL
        CHECK (status IN ('provisioning', 'ready', 'stopping', 'stopped', 'error', 'deleted')),
    error_message text,

    -- Connection details (encrypted JSON containing host, port, credentials, etc.)
    connection_details_encrypted text,

    -- Service-specific configuration
    config jsonb DEFAULT '{}',

    -- Metadata
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes for common queries
CREATE INDEX infra_services_project_id_idx ON public.infra_services(project_id);
CREATE INDEX infra_services_status_idx ON public.infra_services(status);
CREATE INDEX infra_services_fly_machine_id_idx ON public.infra_services(fly_machine_id);

-- Unique constraint: one service of each type per project (for active services)
CREATE UNIQUE INDEX infra_services_project_type_unique
    ON public.infra_services(project_id, service_type)
    WHERE status NOT IN ('deleted', 'error');

-- RLS policies
ALTER TABLE public.infra_services ENABLE ROW LEVEL SECURITY;

-- Users can view services for their own projects
CREATE POLICY "Users can view own project infra services"
    ON public.infra_services FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

-- Users can create services for their own projects
CREATE POLICY "Users can create infra services for own projects"
    ON public.infra_services FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

-- Users can update services for their own projects
CREATE POLICY "Users can update own project infra services"
    ON public.infra_services FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

-- Users can delete services for their own projects
CREATE POLICY "Users can delete own project infra services"
    ON public.infra_services FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = project_id AND p.user_id = auth.uid()
        )
    );

-- Trigger for updated_at
CREATE TRIGGER infra_services_updated_at
    BEFORE UPDATE ON public.infra_services
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
