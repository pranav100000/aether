-- Migration: Add idle timeout and preview token to projects

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS idle_timeout_minutes integer DEFAULT 10,
ADD COLUMN IF NOT EXISTS preview_token text;
