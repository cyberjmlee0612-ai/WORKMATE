-- time + interval은 자정을 넘으면 0시로 돌아가 23:40–23:50 같은 값이 통과한다.
-- time끼리 빼면(interval) 돌아가지 않으므로 그렇게 비교한다.
alter table public.user_settings drop constraint user_settings_work_window;
alter table public.user_settings add constraint user_settings_work_window check (work_end - work_start >= interval '30 minutes');
