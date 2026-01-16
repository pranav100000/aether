-- Migration: 004_user_settings.sql
-- Purpose: Add user settings (default hardware, default idle timeout) and per-project idle timeout

-- ============================================
-- USER SETTINGS TABLE
-- ============================================
CREATE TABLE public.user_settings (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,

    -- Default Hardware Configuration
    default_cpu_kind text DEFAULT 'shared' NOT NULL
        CHECK (default_cpu_kind IN ('shared', 'performance')),
    default_cpus integer DEFAULT 1 NOT NULL
        CHECK (default_cpus >= 1 AND default_cpus <= 16),
    default_memory_mb integer DEFAULT 1024 NOT NULL
        CHECK (default_memory_mb >= 256 AND default_memory_mb <= 32768),
    default_volume_size_gb integer DEFAULT 5 NOT NULL
        CHECK (default_volume_size_gb >= 1 AND default_volume_size_gb <= 500),
    default_gpu_kind text DEFAULT NULL
        CHECK (default_gpu_kind IS NULL OR default_gpu_kind IN ('a10', 'l40s', 'a100-40gb', 'a100-80gb')),

    -- Default Idle Timeout (in minutes)
    -- Preset values: 5, 10, 30, 60, 0 (0 = never auto-stop)
    default_idle_timeout_minutes integer DEFAULT 30 NOT NULL
        CHECK (default_idle_timeout_minutes IN (0, 5, 10, 30, 60)),

    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================
-- ADD IDLE TIMEOUT TO PROJECTS
-- ============================================
ALTER TABLE public.projects
ADD COLUMN idle_timeout_minutes integer DEFAULT NULL
    CHECK (idle_timeout_minutes IS NULL OR idle_timeout_minutes IN (0, 5, 10, 30, 60));

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings"
    ON public.user_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
    ON public.user_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
    ON public.user_settings FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-create user_settings when profile is created
CREATE OR REPLACE FUNCTION public.handle_new_profile_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_settings (user_id)
    VALUES (NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created_settings
    AFTER INSERT ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile_settings();

-- Update updated_at for user_settings
CREATE TRIGGER user_settings_updated_at
    BEFORE UPDATE ON public.user_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- BACKFILL: Create user_settings for existing profiles
-- ============================================
INSERT INTO public.user_settings (user_id)
SELECT id FROM public.profiles
WHERE id NOT IN (SELECT user_id FROM public.user_settings);
