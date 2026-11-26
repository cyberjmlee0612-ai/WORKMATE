-- 업무 시간 기록 (타이머 + 직접 입력) — 시간 기록·타이머·시간표 단계 T1
-- 결정 사항 (2026-11-26 사용자 확정):
--   * 타이머는 사용자당 동시에 하나. 다른 업무에서 시작하면 기존 타이머를 멈추고 새로 시작한다.
--   * 기록끼리 시간이 겹치면 저장하지 않는다 (하루 실제 작업 시간 합계가 항상 정확하도록).
--   * 장시간 타이머: 12시간 이상이면 멈출 때 실제 끝난 시각을 확인받는다. 기록 하나는 최대 24시간.
-- 기본값 (같은 날 안내):
--   * ended_at이 비어 있으면 진행 중인 타이머. 서버에 저장하므로 새로고침·브라우저 종료에도 이어진다.
--   * 기록은 1분 이상. 1분 미만으로 멈춘 타이머는 기록하지 않는다(앱에서 삭제).
--   * 업무를 삭제하면 그 업무의 기록도 삭제(CASCADE). 프로젝트 삭제 시 개인 업무로 옮기면 기록도 함께 남는다.

-- 겹침 방지(exclusion constraint)에서 uuid 같음(=) 비교를 쓰기 위해 필요
create extension if not exists btree_gist with schema extensions;

-- 기록이 같은 소유자의 업무에만 붙도록 복합 FK의 대상 키
alter table public.tasks add constraint tasks_id_user_unique unique (id, user_id);

create table public.task_time_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id    uuid not null,
  started_at timestamptz not null,
  ended_at   timestamptz,  -- null = 진행 중인 타이머
  source     text not null default 'manual',
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_time_entries_source_valid check (source in ('timer', 'manual')),
  -- 진행 중(끝 시각 없음)은 타이머만 가능
  constraint task_time_entries_running_is_timer check (ended_at is not null or source = 'timer'),
  constraint task_time_entries_duration check (
    ended_at is null
    or (ended_at - started_at >= interval '1 minute' and ended_at - started_at <= interval '24 hours')
  ),
  constraint task_time_entries_note_length check (note is null or char_length(note) <= 500),
  constraint task_time_entries_task_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  -- 같은 사용자의 기록끼리 시간 겹침 금지. 진행 중인 타이머는 시작 시각부터 끝없이 이어진 것으로 본다.
  -- '[)' 범위라서 10:00에 끝난 기록과 10:00에 시작한 기록은 겹치지 않는다.
  constraint task_time_entries_no_overlap exclude using gist (
    user_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') with &&
  )
);

-- 진행 중인 타이머는 사용자당 하나
create unique index task_time_entries_one_running on public.task_time_entries (user_id) where ended_at is null;
create index task_time_entries_task_idx on public.task_time_entries (task_id, started_at desc);
create index task_time_entries_user_started_idx on public.task_time_entries (user_id, started_at);

create trigger task_time_entries_set_updated_at
  before update on public.task_time_entries
  for each row execute function public.set_updated_at();

revoke all on public.task_time_entries from anon;
grant select, insert, update, delete on public.task_time_entries to authenticated;

alter table public.task_time_entries enable row level security;

create policy "task_time_entries_select_own" on public.task_time_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "task_time_entries_insert_own" on public.task_time_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "task_time_entries_update_own" on public.task_time_entries
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "task_time_entries_delete_own" on public.task_time_entries
  for delete to authenticated using ((select auth.uid()) = user_id);
