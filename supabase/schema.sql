-- ===========================================================================
-- GHGFlix · Supabase schema
-- Run this once in your Supabase project:  SQL Editor → New query → paste → Run
-- It creates profiles + watch_progress and locks them down with RLS so each
-- user only ever sees their own data.
-- ===========================================================================

-- Profiles (Netflix-style, multiple per account) ----------------------------
create table if not exists public.profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  avatar     text,
  created_at timestamptz not null default now()
);

-- Watch progress, keyed by TMDb coordinates so it matches the same title on
-- any machine. For movies, season/episode are stored as -1.
create table if not exists public.watch_progress (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  media_type   text not null check (media_type in ('movie','episode')),
  tmdb_id      bigint not null,
  season       int not null default -1,
  episode      int not null default -1,
  position_sec double precision not null default 0,
  duration_sec double precision not null default 0,
  watched      boolean not null default false,
  updated_at   bigint not null default 0,
  primary key (profile_id, media_type, tmdb_id, season, episode)
);

-- Row Level Security --------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.watch_progress  enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;

create policy profiles_select_own on public.profiles for select using (auth.uid() = user_id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = user_id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = user_id);
create policy profiles_delete_own on public.profiles for delete using (auth.uid() = user_id);

drop policy if exists wp_select_own on public.watch_progress;
drop policy if exists wp_insert_own on public.watch_progress;
drop policy if exists wp_update_own on public.watch_progress;
drop policy if exists wp_delete_own on public.watch_progress;

create policy wp_select_own on public.watch_progress for select
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy wp_insert_own on public.watch_progress for insert
  with check (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy wp_update_own on public.watch_progress for update
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy wp_delete_own on public.watch_progress for delete
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
