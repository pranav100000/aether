-- Migration: Add hardware configuration to projects
-- Allows users to configure VM hardware (CPU, RAM, storage, GPU) per project

ALTER TABLE public.projects
ADD COLUMN cpu_kind text DEFAULT 'shared' NOT NULL
    CHECK (cpu_kind IN ('shared', 'performance')),
ADD COLUMN cpus integer DEFAULT 1 NOT NULL
    CHECK (cpus >= 1 AND cpus <= 16),
ADD COLUMN memory_mb integer DEFAULT 1024 NOT NULL
    CHECK (memory_mb >= 256 AND memory_mb <= 32768),
ADD COLUMN volume_size_gb integer DEFAULT 5 NOT NULL
    CHECK (volume_size_gb >= 1 AND volume_size_gb <= 500),
ADD COLUMN gpu_kind text DEFAULT NULL
    CHECK (gpu_kind IS NULL OR gpu_kind IN ('a10', 'l40s', 'a100-40gb', 'a100-80gb'));

-- Add index for potential queries by hardware type
CREATE INDEX projects_cpu_kind_idx ON public.projects(cpu_kind);
