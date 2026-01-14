-- Phase 2a: Initial Schema
-- Run this in Supabase Dashboard -> SQL Editor

-- ============================================
-- PROFILES TABLE
-- ============================================

-- Profiles (extends Supabase auth.users)
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    display_name text,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null
);

-- Index for email lookups
create index profiles_email_idx on public.profiles(email);

-- ============================================
-- PROJECTS TABLE
-- ============================================

create table public.projects (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    name text not null,
    description text,

    -- VM state
    fly_machine_id text,
    fly_volume_id text,
    status text default 'stopped' not null
        check (status in ('stopped', 'starting', 'running', 'stopping', 'error')),
    error_message text,

    -- Config
    base_image text default 'base',
    env_vars jsonb default '{}',

    -- Metadata
    last_accessed_at timestamptz,
    created_at timestamptz default now() not null,
    updated_at timestamptz default now() not null,

    -- Constraints
    constraint projects_name_length check (char_length(name) >= 1 and char_length(name) <= 100)
);

-- Indexes
create index projects_user_id_idx on public.projects(user_id);
create index projects_status_idx on public.projects(status);
create index projects_fly_machine_id_idx on public.projects(fly_machine_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.projects enable row level security;

-- Profiles policies
create policy "Users can view own profile"
    on public.profiles for select
    using (auth.uid() = id);

create policy "Users can update own profile"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- Projects policies
create policy "Users can view own projects"
    on public.projects for select
    using (auth.uid() = user_id);

create policy "Users can create own projects"
    on public.projects for insert
    with check (auth.uid() = user_id);

create policy "Users can update own projects"
    on public.projects for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete own projects"
    on public.projects for delete
    using (auth.uid() = user_id);

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, email, display_name)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
    );
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- Auto-update updated_at timestamp
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger profiles_updated_at
    before update on public.profiles
    for each row execute function public.update_updated_at();

create trigger projects_updated_at
    before update on public.projects
    for each row execute function public.update_updated_at();
