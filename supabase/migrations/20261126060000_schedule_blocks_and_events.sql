-- 2026-11-26 사용자 확정
-- 1) 요일별 반복 시간 블록: 일·공부 시간(work) / 수업·고정 일정(fixed) / 쉬는 시간(break).
--    AI 하루 계획은 work 블록 안에만 배치하고 fixed·break는 피한다. 시간표에 배경으로 표시한다.
-- 2) 이벤트 날짜(시험·발표·출품/전시·마감·기타). 프로젝트에 달거나 개인 이벤트로 만든다.
-- 3) user_settings의 단일 일하는 시간·점심 칸은 반복 블록으로 옮기고 지운다.

-- ---------------------------------------------------------------- 반복 시간 블록

create table public.schedule_blocks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null,
  kind       text not null,
  weekdays   smallint not null,      -- 비트 묶음: 일=1, 월=2, 화=4, 수=8, 목=16, 금=32, 토=64
  start_time time not null,
  end_time   time not null,          -- '24:00' 허용 (자정까지)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint schedule_blocks_title_length check (char_length(btrim(title)) between 1 and 40),
  constraint schedule_blocks_kind_valid check (kind in ('work', 'fixed', 'break')),
  constraint schedule_blocks_weekdays_valid check (weekdays between 1 and 127),
  constraint schedule_blocks_window check (end_time - start_time >= interval '10 minutes')
);

create index schedule_blocks_user_idx on public.schedule_blocks (user_id);

create trigger schedule_blocks_set_updated_at
  before update on public.schedule_blocks
  for each row execute function public.set_updated_at();

revoke all on public.schedule_blocks from anon;
grant select, insert, update, delete on public.schedule_blocks to authenticated;
alter table public.schedule_blocks enable row level security;

create policy "schedule_blocks_select_own" on public.schedule_blocks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "schedule_blocks_insert_own" on public.schedule_blocks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "schedule_blocks_update_own" on public.schedule_blocks
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "schedule_blocks_delete_own" on public.schedule_blocks
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 이미 저장한 일하는 시간·점심을 매일 반복 블록으로 옮긴다
insert into public.schedule_blocks (user_id, title, kind, weekdays, start_time, end_time)
select user_id, '일하는 시간', 'work', 127, work_start, work_end from public.user_settings;
insert into public.schedule_blocks (user_id, title, kind, weekdays, start_time, end_time)
select user_id, '점심', 'break', 127, lunch_start, lunch_end from public.user_settings where lunch_enabled;

alter table public.user_settings
  drop constraint user_settings_work_window,
  drop constraint user_settings_lunch_window,
  drop column work_start,
  drop column work_end,
  drop column lunch_enabled,
  drop column lunch_start,
  drop column lunch_end;

-- ---------------------------------------------------------------- 이벤트

create table public.events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid,
  title      text not null,
  kind       text not null default 'other',
  event_date date not null,
  start_time time,                   -- 둘 다 없으면 종일
  end_time   time,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint events_title_length check (char_length(btrim(title)) between 1 and 100),
  constraint events_kind_valid check (kind in ('exam', 'presentation', 'exhibition', 'deadline', 'other')),
  constraint events_time_pair check (end_time is null or start_time is not null),
  constraint events_time_order check (end_time is null or end_time > start_time),
  constraint events_note_length check (note is null or char_length(note) <= 500),
  -- 같은 소유자의 프로젝트만. 프로젝트를 지우면 이벤트는 개인 이벤트로 남는다 (project_id만 비운다)
  constraint events_project_same_owner_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete set null (project_id)
);

create index events_user_date_idx on public.events (user_id, event_date);
create index events_project_idx on public.events (project_id) where project_id is not null;

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

revoke all on public.events from anon;
grant select, insert, update, delete on public.events to authenticated;
alter table public.events enable row level security;

create policy "events_select_own" on public.events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "events_insert_own" on public.events
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "events_update_own" on public.events
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "events_delete_own" on public.events
  for delete to authenticated using ((select auth.uid()) = user_id);
