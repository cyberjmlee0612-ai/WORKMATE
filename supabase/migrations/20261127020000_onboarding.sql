-- 처음 사용자 안내 (2026-11-27 사용자 확정: 첫 로그인 안내 화면 + 대시보드 체크리스트, 기존 계정은 보이지 않음)
-- onboarding_state: null(아직 정하지 않음 — 새 사용자면 안내 화면) / wizard(다시 보기로 안내 화면) /
--                   checklist(안내 화면을 나갔고 대시보드 체크리스트로 이어서) / done(끝냈거나 닫음)
-- 단계 완료 여부는 실제 데이터로 판단한다 (시간표 블록·업무·계획 블록이 있는지).
alter table public.user_settings
  add column onboarding_state text,
  add constraint user_settings_onboarding_state_valid check (onboarding_state is null or onboarding_state in ('wizard', 'checklist', 'done'));
