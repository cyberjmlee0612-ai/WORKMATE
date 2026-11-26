-- 프로젝트 계층 (상위 → 하위 → 그 하위) — 2026-11-26 사용자 확정
--   * 최대 3단계. 자기 자신·자기 하위 아래로는 넣을 수 없다(순환 금지).
--   * 상위 프로젝트에도 업무를 직접 둘 수 있다. 진행률은 하위 프로젝트 업무까지 합산(앱 계산).
--   * 보관: 하위도 함께 보관되고, 다시 열면 그때 함께 보관된 하위도 함께 돌아온다 → 이벤트에 via_project_id 기록.
--   * 삭제: 하위를 한 단계 위로 꺼내거나 함께 삭제(사용자가 선택). 앱이 하위를 먼저 처리하므로 FK는 RESTRICT.

alter table public.projects add column parent_id uuid;

alter table public.projects
  add constraint projects_parent_not_self check (parent_id is null or parent_id <> id),
  -- 같은 소유자의 프로젝트 아래로만
  add constraint projects_parent_fk foreign key (parent_id, user_id)
    references public.projects (id, user_id) on delete restrict;

create index projects_parent_idx on public.projects (parent_id) where parent_id is not null;

-- 깊이·순환 검사 (앱이 먼저 친절한 메시지로 막고, 이것은 최후 방어선)
create or replace function public.check_project_tree()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ancestors integer;
  has_cycle boolean;
  subtree_height integer;
begin
  if new.parent_id is null then
    return new;
  end if;

  with recursive anc as (
    select p.id, p.parent_id, 1 as lvl from public.projects p where p.id = new.parent_id
    union all
    select p.id, p.parent_id, anc.lvl + 1 from public.projects p join anc on p.id = anc.parent_id where anc.lvl < 10
  )
  select max(lvl), coalesce(bool_or(id = new.id), false) into ancestors, has_cycle from anc;

  if has_cycle then
    raise exception 'project tree cycle' using errcode = 'check_violation';
  end if;

  with recursive sub as (
    select p.id, 0 as h from public.projects p where p.parent_id = new.id
    union all
    select p.id, sub.h + 1 from public.projects p join sub on p.parent_id = sub.id where sub.h < 10
  )
  select coalesce(max(h) + 1, 0) into subtree_height from sub;

  -- 조상 수 + 자기 자신 + 아래 높이 ≤ 3
  if ancestors + 1 + subtree_height > 3 then
    raise exception 'project tree too deep' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger projects_check_tree
  before insert or update of parent_id on public.projects
  for each row execute function public.check_project_tree();

-- 상위와 함께 보관·복원된 이벤트: 어느 프로젝트의 보관/복원 때문인지 (직접 한 경우 null)
alter table public.project_status_events add column via_project_id uuid;
