-- 아침 체크인 / 저녁 마무리 (2026-11-26 사용자 확정)
-- daily_focus: 그날 '꼭 할 일'(최대 3개, 앱에서 제한). outcome은 저녁 마무리에서 정한 결과.
--   done(완료) / retry(내일 다시: 다음 체크인에 먼저 추천) / postponed(마감일 미룸) / kept(그대로 둠)
-- daily_reviews: 그날 기분(1~5)과 한 줄 회고. 날짜는 사용자 시간대 기준 달력 날짜.

create table public.daily_focus (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  focus_date date not null,
  task_id    uuid not null,
  position   smallint not null,
  outcome    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, focus_date, task_id),
  constraint daily_focus_position_valid check (position between 1 and 5),
  constraint daily_focus_outcome_valid check (outcome is null or outcome in ('done', 'retry', 'postponed', 'kept')),
  -- 업무를 지우면 그날 꼭 할 일에서도 빠진다
  constraint daily_focus_task_same_owner_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade
);

create index daily_focus_task_idx on public.daily_focus (task_id);

create trigger daily_focus_set_updated_at
  before update on public.daily_focus
  for each row execute function public.set_updated_at();

revoke all on public.daily_focus from anon;
grant select, insert, update, delete on public.daily_focus to authenticated;
alter table public.daily_focus enable row level security;

create policy "daily_focus_select_own" on public.daily_focus
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "daily_focus_insert_own" on public.daily_focus
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "daily_focus_update_own" on public.daily_focus
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "daily_focus_delete_own" on public.daily_focus
  for delete to authenticated using ((select auth.uid()) = user_id);

create table public.daily_reviews (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  review_date date not null,
  mood        smallint,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (user_id, review_date),
  constraint daily_reviews_mood_valid check (mood is null or mood between 1 and 5),
  constraint daily_reviews_note_length check (note is null or char_length(note) <= 500)
);

create trigger daily_reviews_set_updated_at
  before update on public.daily_reviews
  for each row execute function public.set_updated_at();

revoke all on public.daily_reviews from anon;
grant select, insert, update, delete on public.daily_reviews to authenticated;
alter table public.daily_reviews enable row level security;

create policy "daily_reviews_select_own" on public.daily_reviews
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "daily_reviews_insert_own" on public.daily_reviews
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "daily_reviews_update_own" on public.daily_reviews
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "daily_reviews_delete_own" on public.daily_reviews
  for delete to authenticated using ((select auth.uid()) = user_id);
