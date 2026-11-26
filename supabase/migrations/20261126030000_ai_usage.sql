-- AI 업무 도우미 사용량 — 사용자당 하루 요청 수 제한 (2026-11-26 사용자 확정: 하루 30회, 설정값으로 변경 가능)
-- 날짜는 사용자 시간대 기준. AI 호출 전에 1 늘리고, 제공자 오류로 실패하면 되돌린다(앱).

create table public.ai_usage (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  used_on    date not null,
  count      integer not null default 0,
  updated_at timestamptz not null default now(),

  primary key (user_id, used_on),
  constraint ai_usage_count_nonnegative check (count >= 0)
);

create trigger ai_usage_set_updated_at
  before update on public.ai_usage
  for each row execute function public.set_updated_at();

revoke all on public.ai_usage from anon;
grant select, insert, update on public.ai_usage to authenticated;

alter table public.ai_usage enable row level security;

create policy "ai_usage_select_own" on public.ai_usage
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "ai_usage_insert_own" on public.ai_usage
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "ai_usage_update_own" on public.ai_usage
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
