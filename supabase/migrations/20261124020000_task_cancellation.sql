-- 업무 '제외(취소)' 상태 추가 — PRD P1 "불필요해진 업무를 취소 상태로 보존"
-- 결정 사항 (2026-11-24 사용자 확정):
--   * 상태값 'cancelled' 추가. 삭제와 구분되며 KPI·진행률의 분자·분모에서 모두 제외한다 (조회 쿼리에서 처리).
--   * 제외 시각(cancelled_at)은 자동 기록, 사유(cancel_reason)는 선택 입력.
--   * 다른 상태로 바꾸면(재활성화) 시각·사유를 비운다.

alter table public.tasks
  add column cancelled_at  timestamptz,
  add column cancel_reason text;

alter table public.tasks drop constraint tasks_status_valid;
alter table public.tasks add constraint tasks_status_valid
  check (status in ('todo', 'in_progress', 'review', 'completed', 'cancelled'));

alter table public.tasks add constraint tasks_cancelled_at_consistency
  check ((status = 'cancelled') = (cancelled_at is not null));
alter table public.tasks add constraint tasks_cancel_reason_only_when_cancelled
  check (cancel_reason is null or status = 'cancelled');
alter table public.tasks add constraint tasks_cancel_reason_length
  check (cancel_reason is null or char_length(cancel_reason) <= 500);

-- 상태에 딸린 시각 필드를 한 함수에서 관리 (기존 completed_at 트리거를 대체)
create or replace function public.sync_task_status_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 완료 시각
  if new.status = 'completed' then
    if tg_op = 'UPDATE' and old.status = 'completed' then
      new.completed_at := coalesce(new.completed_at, old.completed_at);
    else
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;

  -- 제외 시각·사유
  if new.status = 'cancelled' then
    if tg_op = 'UPDATE' and old.status = 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, old.cancelled_at);
    else
      new.cancelled_at := coalesce(new.cancelled_at, now());
    end if;
    new.cancel_reason := nullif(btrim(new.cancel_reason), '');
  else
    new.cancelled_at := null;
    new.cancel_reason := null;
  end if;

  return new;
end;
$$;

drop trigger tasks_sync_completed_at on public.tasks;
drop function public.sync_task_completed_at();

create trigger tasks_sync_status_fields
  before insert or update on public.tasks
  for each row execute function public.sync_task_status_fields();
