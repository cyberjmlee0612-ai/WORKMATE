-- 업무 계획 블록 — 시간 기록·타이머·시간표 단계 T2 (시간표에 업무를 끌어다 놓아 계획)
-- 결정 사항 (2026-11-26 사용자 확정):
--   * 사이드바의 업무를 시간표에 끌어다 놓아(모바일은 누르고 배치) 계획 블록을 만든다.
--   * 블록 크기는 10분 단위로 늘리고 줄인다 (10분 맞춤은 화면에서. 시간대마다 정각이 달라 DB에서는 강제하지 않음).
--   * 같은 업무를 여러 번 배치할 수 있다.
--   * 계획끼리는 겹쳐도 된다 (나란히 표시). 실제 기록(task_time_entries)과도 별개다.
-- 기본값: 블록 하나는 10분~24시간. 업무를 삭제하면 그 업무의 계획도 삭제(CASCADE).

create table public.task_time_plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id    uuid not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_time_plans_duration check (
    ends_at - starts_at >= interval '10 minutes' and ends_at - starts_at <= interval '24 hours'
  ),
  constraint task_time_plans_task_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade
);

create index task_time_plans_user_starts_idx on public.task_time_plans (user_id, starts_at);
create index task_time_plans_task_idx on public.task_time_plans (task_id);

create trigger task_time_plans_set_updated_at
  before update on public.task_time_plans
  for each row execute function public.set_updated_at();

revoke all on public.task_time_plans from anon;
grant select, insert, update, delete on public.task_time_plans to authenticated;

alter table public.task_time_plans enable row level security;

create policy "task_time_plans_select_own" on public.task_time_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "task_time_plans_insert_own" on public.task_time_plans
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "task_time_plans_update_own" on public.task_time_plans
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "task_time_plans_delete_own" on public.task_time_plans
  for delete to authenticated using ((select auth.uid()) = user_id);
