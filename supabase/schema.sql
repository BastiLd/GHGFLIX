-- ===========================================================================
-- GHGFlix · Supabase-Schema (v2)
--
-- EINMALIG im Supabase-Projekt ausführen:
--   Supabase öffnen → linkes Menü "SQL Editor" → "New query" →
--   diese Datei komplett hineinkopieren → grüner Knopf "Run".
--
-- Es entstehen vier Tabellen:
--   profiles         – deine Profile (wie die Netflix-Profile)
--   watch_progress   – wo du in welchem Film/welcher Folge stehst
--   watch_favorites  – "Meine Liste"
--   sync_devices     – welches Gerät zuletzt wann abgeglichen hat
--
-- Alles ist mit Row Level Security abgesichert: Selbst wenn jemand deinen
-- öffentlichen anon-Key hätte, sieht er ohne DEINE Anmeldung keine Zeile.
-- Das Skript ist gefahrlos mehrfach ausführbar (es löscht keine Daten).
-- ===========================================================================

-- Profile (Netflix-Stil, mehrere pro Konto) --------------------------------
create table if not exists public.profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  avatar     text,
  created_at timestamptz not null default now()
);

-- Fortschritt, geschlüsselt über TMDb-Koordinaten, damit derselbe Titel auf
-- jedem Gerät wiedergefunden wird. Bei Filmen stehen season/episode auf -1.
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

-- "Meine Liste" ------------------------------------------------------------
create table if not exists public.watch_favorites (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('movie','show')),
  tmdb_id    bigint not null,
  added_at   bigint not null default 0,
  removed    boolean not null default false,
  updated_at bigint not null default 0,
  primary key (profile_id, media_type, tmdb_id)
);

-- Geräteliste (rein informativ: "PC zuletzt abgeglichen um …") -------------
create table if not exists public.sync_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_key  text not null,
  name        text,
  platform    text,
  app_version text,
  last_seen   bigint not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, device_key)
);

-- Row Level Security --------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.watch_progress  enable row level security;
alter table public.watch_favorites enable row level security;
alter table public.sync_devices    enable row level security;

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

drop policy if exists wf_select_own on public.watch_favorites;
drop policy if exists wf_insert_own on public.watch_favorites;
drop policy if exists wf_update_own on public.watch_favorites;
drop policy if exists wf_delete_own on public.watch_favorites;

create policy wf_select_own on public.watch_favorites for select
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy wf_insert_own on public.watch_favorites for insert
  with check (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy wf_update_own on public.watch_favorites for update
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));
create policy wf_delete_own on public.watch_favorites for delete
  using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()));

drop policy if exists sd_select_own on public.sync_devices;
drop policy if exists sd_insert_own on public.sync_devices;
drop policy if exists sd_update_own on public.sync_devices;
drop policy if exists sd_delete_own on public.sync_devices;

create policy sd_select_own on public.sync_devices for select using (auth.uid() = user_id);
create policy sd_insert_own on public.sync_devices for insert with check (auth.uid() = user_id);
create policy sd_update_own on public.sync_devices for update using (auth.uid() = user_id);
create policy sd_delete_own on public.sync_devices for delete using (auth.uid() = user_id);

-- Tempo --------------------------------------------------------------------
create index if not exists idx_watch_progress_profile_updated
  on public.watch_progress (profile_id, updated_at desc);
create index if not exists idx_watch_progress_updated
  on public.watch_progress (updated_at desc);
create index if not exists idx_watch_favorites_profile_updated
  on public.watch_favorites (profile_id, updated_at desc);
create index if not exists idx_profiles_user on public.profiles (user_id);
