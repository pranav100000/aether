-- Migration: 003_api_keys.sql
-- Purpose: Add encrypted API keys storage to profiles table for Phase 4 (Agent Integration)

-- Add encrypted API keys column to profiles
-- Stores encrypted JSON: {"anthropic": "sk-...", "openai": "sk-..."}
-- Encrypted with AES-256-GCM, master key from ENCRYPTION_MASTER_KEY env var
ALTER TABLE public.profiles ADD COLUMN api_keys_encrypted text;
