-- 밀린 계획 다시 짜기 (2026-11-26 사용자 확정)
-- 밀린 계획 = 끝난 계획 블록 중 업무가 미완료이고 그 시간에 기록한 시간이 계획의 절반 미만 (최근 7일, 앱에서 계산).
-- 처리하면 원래 블록은 지우지 않고 결과를 남긴다 (리포트의 계획 대비 실제를 정직하게 유지):
--   rescheduled(다시 배치함 — 원래 블록은 '놓침'으로 표시) / done(실제로 했음 — 계획 시간을 기록으로 바꿈) / let_go(놓아줌)
alter table public.task_time_plans
  add column resolution text,
  add column resolved_at timestamptz,
  add constraint task_time_plans_resolution_valid check (resolution is null or resolution in ('rescheduled', 'done', 'let_go')),
  add constraint task_time_plans_resolved_pair check ((resolution is null) = (resolved_at is null));
