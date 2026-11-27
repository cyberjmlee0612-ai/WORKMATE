-- 집중 모드 (2026-11-27 사용자 확정: 뽀모도로, 방해 기록, 타이머와는 별개)
-- focus_sessions: 집중 한 번(25분 등). 끝까지 하면 completed=true, 중간에 그만두면 false. 휴식은 저장하지 않는다.
-- focus_interruptions: 집중 중 '방해받음' (이유는 선택).

create table public.focus_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id       uuid,
  focus_minutes smallint not null,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  completed     boolean not null default false,
  created_at    timestamptz not null default now(),

  unique (id, user_id),
  constraint focus_sessions_minutes_valid check (focus_minutes between 5 and 120),
  constraint focus_sessions_end_after_start check (ended_at is null or ended_at >= started_at),
  -- 업무를 지워도 집중 기록은 남긴다 (task_id만 비움)
  constraint focus_sessions_task_same_owner_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete set null (task_id)
);

create index focus_sessions_user_started_idx on public.focus_sessions (user_id, started_at);

revoke all on public.focus_sessions from anon;
grant select, insert, update, delete on public.focus_sessions to authenticated;
alter table public.focus_sessions enable row level security;

create policy "focus_sessions_select_own" on public.focus_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "focus_sessions_insert_own" on public.focus_sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "focus_sessions_update_own" on public.focus_sessions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "focus_sessions_delete_own" on public.focus_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.focus_interruptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  reason     text,
  created_at timestamptz not null default now(),

  constraint focus_interruptions_reason_valid check (reason is null or reason in ('message', 'call', 'thought', 'noise', 'other')),
  constraint focus_interruptions_session_same_owner_fk foreign key (session_id, user_id)
    references public.focus_sessions (id, user_id) on delete cascade
);

create index focus_interruptions_session_idx on public.focus_interruptions (session_id);

revoke all on public.focus_interruptions from anon;
grant select, insert, update, delete on public.focus_interruptions to authenticated;
alter table public.focus_interruptions enable row level security;

create policy "focus_interruptions_select_own" on public.focus_interruptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "focus_interruptions_insert_own" on public.focus_interruptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "focus_interruptions_update_own" on public.focus_interruptions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "focus_interruptions_delete_own" on public.focus_interruptions
  for delete to authenticated using ((select auth.uid()) = user_id);
