-- 날짜별 메모 — 시간표 일간 보기의 오른쪽 패널 (2026-11-26 사용자 요청)
-- 사용자·날짜당 하나. 내용을 모두 지우면 행을 삭제한다(앱). 날짜는 사용자 시간대 기준 달력 날짜.

create table public.daily_notes (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_date  date not null,
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, note_date),
  constraint daily_notes_content_length check (char_length(content) between 1 and 5000)
);

create trigger daily_notes_set_updated_at
  before update on public.daily_notes
  for each row execute function public.set_updated_at();

revoke all on public.daily_notes from anon;
grant select, insert, update, delete on public.daily_notes to authenticated;

alter table public.daily_notes enable row level security;

create policy "daily_notes_select_own" on public.daily_notes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "daily_notes_insert_own" on public.daily_notes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "daily_notes_update_own" on public.daily_notes
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "daily_notes_delete_own" on public.daily_notes
  for delete to authenticated using ((select auth.uid()) = user_id);
