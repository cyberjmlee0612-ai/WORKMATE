-- 반복 업무 · 습관 (2026-11-27 사용자 확정)
-- routines: 반복 규칙. mode = task(그날 업무를 만들어 줌) / habit(체크만, 연속 기록)
--   freq = daily(매일) / weekly(고른 요일, every_weeks주마다 — 격주 등) / monthly(매월 month_day일, 없는 날은 그달 마지막 날)
--          / interval(start_date부터 interval_days일마다)
--   start_time·end_time을 정하면 반복 업무와 함께 그 시간 계획 블록도 만든다.
-- tasks.routine_id·routine_date: 반복으로 만든 업무 (같은 날 두 번 만들지 않게 유일).
--   그날 하지 않은 반복 업무는 다음 날 '제외(건너뜀)'로 정리한다 (앱).
-- habit_checks: 습관 체크 (날짜별).

create table public.routines (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title             text not null,
  mode              text not null default 'task',
  project_id        uuid,
  priority          text not null default 'medium',
  estimated_minutes integer,
  freq              text not null,
  weekdays          smallint,          -- weekly: 비트 묶음 일=1 … 토=64
  every_weeks       smallint not null default 1,
  month_day         smallint,          -- monthly
  interval_days     smallint,          -- interval
  start_date        date not null,
  start_time        time,
  end_time          time,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (id, user_id),
  constraint routines_title_length check (char_length(btrim(title)) between 1 and 100),
  constraint routines_mode_valid check (mode in ('task', 'habit')),
  constraint routines_priority_valid check (priority in ('low', 'medium', 'high', 'urgent')),
  constraint routines_estimate_positive check (estimated_minutes is null or estimated_minutes between 1 and 1440),
  constraint routines_freq_valid check (freq in ('daily', 'weekly', 'monthly', 'interval')),
  constraint routines_weekly_rule check (freq <> 'weekly' or (weekdays between 1 and 127)),
  constraint routines_every_weeks_valid check (every_weeks between 1 and 8),
  constraint routines_monthly_rule check (freq <> 'monthly' or (month_day between 1 and 31)),
  constraint routines_interval_rule check (freq <> 'interval' or (interval_days between 2 and 365)),
  constraint routines_time_pair check ((start_time is null) = (end_time is null)),
  constraint routines_time_order check (end_time is null or end_time - start_time >= interval '10 minutes'),
  constraint routines_project_same_owner_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete set null (project_id)
);

create index routines_user_idx on public.routines (user_id);

create trigger routines_set_updated_at
  before update on public.routines
  for each row execute function public.set_updated_at();

revoke all on public.routines from anon;
grant select, insert, update, delete on public.routines to authenticated;
alter table public.routines enable row level security;

create policy "routines_select_own" on public.routines
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "routines_insert_own" on public.routines
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "routines_update_own" on public.routines
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "routines_delete_own" on public.routines
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 반복으로 만든 업무. 반복을 지워도 업무는 남는다 (routine_id만 비움)
alter table public.tasks
  add column routine_id uuid,
  add column routine_date date,
  add constraint tasks_routine_pair check (routine_id is null or routine_date is not null),
  add constraint tasks_routine_same_owner_fk foreign key (routine_id, user_id)
    references public.routines (id, user_id) on delete set null (routine_id);

create unique index tasks_routine_day_uniq on public.tasks (routine_id, routine_date) where routine_id is not null;

create table public.habit_checks (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  routine_id uuid not null,
  check_date date not null,
  created_at timestamptz not null default now(),

  primary key (routine_id, check_date),
  constraint habit_checks_routine_same_owner_fk foreign key (routine_id, user_id)
    references public.routines (id, user_id) on delete cascade
);

create index habit_checks_user_idx on public.habit_checks (user_id, check_date);

revoke all on public.habit_checks from anon;
grant select, insert, delete on public.habit_checks to authenticated;
alter table public.habit_checks enable row level security;

create policy "habit_checks_select_own" on public.habit_checks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "habit_checks_insert_own" on public.habit_checks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "habit_checks_delete_own" on public.habit_checks
  for delete to authenticated using ((select auth.uid()) = user_id);
