-- 프로젝트 완료·보관·복원 이력 — PRD P1 "프로젝트를 완료·보관하고 다시 열거나 이전 상태로 복원"
-- 결정 사항 (2026-11-24 사용자 확정):
--   * 모든 완료·보관·복원을 이력으로 남긴다 (변경 불가, 추가만).
--   * 복원은 '직전 상태'로: 현재 상태로 들어오게 만든 마지막 이벤트의 from_status로 되돌린다.
--     예) 진행 중 → 완료 → 보관 이면, 복원 시 보관 → 완료, 한 번 더 복원 시 완료 → 진행 중.
--   * 보관은 어떤 상태에서든 가능. 완료는 진행 중 상태(계획/진행 중/검토)에서만.
--   * 완료 당시 미완료 업무 수(완료·제외되지 않은 업무)를 기록한다.

create table public.project_status_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id  uuid not null,
  action      text not null,
  from_status text not null,
  to_status   text not null,
  open_tasks  integer,  -- action = 'complete'일 때만: 완료 당시 미완료 업무 수
  occurred_at timestamptz not null default now(),

  constraint project_status_events_action_valid check (action in ('complete', 'archive', 'restore')),
  constraint project_status_events_status_valid check (
    from_status in ('planning', 'in_progress', 'review', 'completed', 'archived')
    and to_status in ('planning', 'in_progress', 'review', 'completed', 'archived')
    and from_status <> to_status
  ),
  constraint project_status_events_open_tasks check (
    (action = 'complete') = (open_tasks is not null) and (open_tasks is null or open_tasks >= 0)
  ),
  -- 같은 소유자의 프로젝트에만 기록. 이력은 프로젝트에 딸린 메타데이터이므로 프로젝트와 함께 지운다
  -- (삭제 흐름에서도 명시적으로 지우고, CASCADE는 안전장치)
  constraint project_status_events_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete cascade
);

create index project_status_events_project_idx on public.project_status_events (project_id, occurred_at desc);

-- 권한·RLS: 이력은 추가·조회만, 수정 불가. 삭제는 프로젝트 삭제 흐름에서만 쓴다.
revoke all on public.project_status_events from anon;
grant select, insert, delete on public.project_status_events to authenticated;

alter table public.project_status_events enable row level security;

create policy "project_status_events_select_own" on public.project_status_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "project_status_events_insert_own" on public.project_status_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "project_status_events_delete_own" on public.project_status_events
  for delete to authenticated using ((select auth.uid()) = user_id);
