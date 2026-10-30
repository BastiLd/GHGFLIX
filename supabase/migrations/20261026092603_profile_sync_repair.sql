alter table public.profiles add column if not exists updated_at bigint not null default 0;
create or replace function public.ghg_keep_newest_sync() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if NEW.updated_at < OLD.updated_at then return OLD; end if;
  if TG_TABLE_NAME = 'profiles' and NEW.updated_at = OLD.updated_at then
    NEW.updated_at := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  end if;
  return NEW;
end;
$$;
revoke all on function public.ghg_keep_newest_sync() from public, anon, authenticated;
drop trigger if exists ghg_profiles_newest on public.profiles;
create trigger ghg_profiles_newest before update on public.profiles for each row execute function public.ghg_keep_newest_sync();
drop trigger if exists ghg_progress_newest on public.watch_progress;
create trigger ghg_progress_newest before update on public.watch_progress for each row execute function public.ghg_keep_newest_sync();
drop trigger if exists ghg_favorites_newest on public.watch_favorites;
create trigger ghg_favorites_newest before update on public.watch_favorites for each row execute function public.ghg_keep_newest_sync();
alter policy profiles_update_own on public.profiles to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
alter policy wp_update_own on public.watch_progress to authenticated using (exists(select 1 from public.profiles p where p.id=profile_id and p.user_id=(select auth.uid()))) with check (exists(select 1 from public.profiles p where p.id=profile_id and p.user_id=(select auth.uid())));
alter policy wf_update_own on public.watch_favorites to authenticated using (exists(select 1 from public.profiles p where p.id=profile_id and p.user_id=(select auth.uid()))) with check (exists(select 1 from public.profiles p where p.id=profile_id and p.user_id=(select auth.uid())));
