-- WORKMATE 1단계 초기 스키마: projects, tasks, 제약조건, 인덱스, RLS
-- 기준: docs/prd.md §4. P1 항목(cancelled 상태, 완료 이력 등)은 결정 후 별도 마이그레이션으로 추가한다.

-- ---------------------------------------------------------------------------
-- 공통: updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  -- 클라이언트 입력을 신뢰하지 않도록 기본값을 인증 주체로 둔다 (RLS가 일치 여부를 다시 검사)
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  description text,
  status      text not null default 'planning',
  start_date  date,
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint projects_name_not_blank check (length(btrim(name)) > 0),
  constraint projects_name_length check (char_length(name) <= 200),
  -- ENUM 대신 TEXT + CHECK: 상태 추가(예: P1 정책 변경) 시 제약만 교체하면 된다
  constraint projects_status_valid check (status in ('planning', 'in_progress', 'review', 'completed', 'archived')),
  constraint projects_date_order check (start_date is null or due_date is null or start_date <= due_date),
  -- tasks의 복합 FK(project_id, user_id)가 참조할 대상
  constraint projects_id_user_unique unique (id, user_id)
);

create index projects_user_status_idx on public.projects (user_id, status);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id        uuid,  -- NULL이면 개인 업무
  title             text not null,
  description       text,
  status            text not null default 'todo',
  priority          text not null default 'medium',
  due_date          date,
  estimated_minutes integer,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tasks_title_not_blank check (length(btrim(title)) > 0),
  constraint tasks_title_length check (char_length(title) <= 300),
  constraint tasks_status_valid check (status in ('todo', 'in_progress', 'review', 'completed')),
  constraint tasks_priority_valid check (priority in ('low', 'medium', 'high', 'urgent')),
  constraint tasks_estimated_minutes_positive check (estimated_minutes is null or estimated_minutes > 0),
  -- 상태와 completed_at의 일관성을 DB에서 강제 (트리거가 자동으로 맞춰 준다)
  constraint tasks_completed_at_consistency check ((status = 'completed') = (completed_at is not null)),
  -- 같은 소유자의 프로젝트에만 연결 가능. RLS는 FK 대상의 소유자를 검사하지 않으므로 복합 FK로 막는다.
  -- ON DELETE RESTRICT: 연결 업무를 명시적으로 이동/삭제하지 않으면 프로젝트를 지울 수 없다 (PRD: CASCADE에 의존하지 않음)
  constraint tasks_project_same_owner_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete restrict
);

create index tasks_project_user_idx on public.tasks (project_id, user_id);      -- FK 검사, 프로젝트별 조회
create index tasks_user_status_idx on public.tasks (user_id, status);           -- KPI 집계
create index tasks_user_due_date_idx on public.tasks (user_id, due_date);       -- 마감일 조회
create index tasks_user_personal_idx on public.tasks (user_id) where project_id is null;  -- 개인 업무

-- 완료로 바뀌면 completed_at 기록, 완료에서 벗어나면 초기화
create or replace function public.sync_task_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'UPDATE' and old.status = 'completed' then
      new.completed_at := coalesce(new.completed_at, old.completed_at);
    else
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger tasks_sync_completed_at
  before insert or update on public.tasks
  for each row execute function public.sync_task_completed_at();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 권한 및 RLS: 로그인 사용자만, 본인 행만
-- ---------------------------------------------------------------------------
revoke all on public.projects, public.tasks from anon;
grant select, insert, update, delete on public.projects, public.tasks to authenticated;

alter table public.projects enable row level security;
alter table public.tasks enable row level security;

-- (select auth.uid()) 형태는 행마다 함수를 다시 호출하지 않도록 하는 Supabase 권장 패턴
create policy "projects_select_own" on public.projects
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "projects_insert_own" on public.projects
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "projects_update_own" on public.projects
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "projects_delete_own" on public.projects
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "tasks_select_own" on public.tasks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "tasks_insert_own" on public.tasks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tasks_update_own" on public.tasks
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tasks_delete_own" on public.tasks
  for delete to authenticated using ((select auth.uid()) = user_id);
