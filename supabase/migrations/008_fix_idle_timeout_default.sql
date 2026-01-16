-- Migration: 008_fix_idle_timeout_default.sql
-- Purpose: Make default_idle_timeout_minutes NOT NULL with a default of 30

-- Backfill existing NULL values to 30
UPDATE public.user_settings
SET default_idle_timeout_minutes = 30
WHERE default_idle_timeout_minutes IS NULL;

-- Alter column to NOT NULL with default
ALTER TABLE public.user_settings
ALTER COLUMN default_idle_timeout_minutes SET DEFAULT 30,
ALTER COLUMN default_idle_timeout_minutes SET NOT NULL;

-- Update the check constraint to remove NULL option
ALTER TABLE public.user_settings
DROP CONSTRAINT IF EXISTS user_settings_default_idle_timeout_minutes_check;

ALTER TABLE public.user_settings
ADD CONSTRAINT user_settings_default_idle_timeout_minutes_check
CHECK (default_idle_timeout_minutes IN (0, 5, 10, 30, 60));
