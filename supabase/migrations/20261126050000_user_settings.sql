-- 사용자 설정 (2026-11-26 사용자 확정): 표시 이름, 일하는 시간·쉬는 시간 기본값 (AI 하루 계획 기본값)
-- 사용자당 한 행. 행이 없으면 앱이 기본값(09:00–18:00, 점심 12:00–13:00)을 쓴다.

create table public.user_settings (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  display_name  text,
  work_start    time not null default '09:00',
  work_end      time not null default '18:00',
  lunch_enabled boolean not null default true,
  lunch_start   time not null default '12:00',
  lunch_end     time not null default '13:00',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint user_settings_display_name_length check (display_name is null or char_length(display_name) between 1 and 30),
  constraint user_settings_work_window check (work_end >= work_start + interval '30 minutes'),
  constraint user_settings_lunch_window check (lunch_end > lunch_start)
);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

revoke all on public.user_settings from anon;
grant select, insert, update, delete on public.user_settings to authenticated;

alter table public.user_settings enable row level security;

create policy "user_settings_select_own" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_settings_insert_own" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_settings_update_own" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_settings_delete_own" on public.user_settings
  for delete to authenticated using ((select auth.uid()) = user_id);
