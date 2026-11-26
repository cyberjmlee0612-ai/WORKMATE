import type { Project, ProjectStatus } from "@/lib/api/projects";

/** 프로젝트 계층 (상위 → 하위 → 그 하위, 최대 3단계 — 2026-11-26 사용자 확정). 서버도 같은 규칙으로 막는다. */
export const MAX_PROJECT_DEPTH = 3;

export type Category = "active" | "completed" | "archived";
export const categoryOf = (status: ProjectStatus): Category =>
  status === "completed" ? "completed" : status === "archived" ? "archived" : "active";

export type ProjectTree = {
  byId: Map<string, Project>;
  children: Map<string, Project[]>;
};

export function buildTree(projects: Project[]): ProjectTree {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const children = new Map<string, Project[]>();
  for (const p of projects) {
    if (!p.parent_id) continue;
    const list = children.get(p.parent_id) ?? [];
    list.push(p);
    children.set(p.parent_id, list);
  }
  return { byId, children };
}

/** 최상위부터 바로 위 상위까지 */
export function ancestorsOf(tree: ProjectTree, id: string): Project[] {
  const out: Project[] = [];
  let current = tree.byId.get(id)?.parent_id;
  while (current && out.length < 10) {
    const p = tree.byId.get(current);
    if (!p) break;
    out.unshift(p);
    current = p.parent_id;
  }
  return out;
}

/** 1 = 최상위 */
export const depthOf = (tree: ProjectTree, id: string) => ancestorsOf(tree, id).length + 1;

export function descendantsOf(tree: ProjectTree, id: string): Project[] {
  const out: Project[] = [];
  const walk = (pid: string, level: number) => {
    if (level > 10) return;
    for (const c of tree.children.get(pid) ?? []) {
      out.push(c);
      walk(c.id, level + 1);
    }
  };
  walk(id, 1);
  return out;
}

/** 자기 아래로 몇 단계가 더 있는지 (하위 없음 = 0) */
export function heightOf(tree: ProjectTree, id: string): number {
  const kids = tree.children.get(id) ?? [];
  return kids.length === 0 ? 0 : 1 + Math.max(...kids.map((k) => heightOf(tree, k.id)));
}

/** "상위 › 하위" 형태 이름 (선택 목록용) */
export function pathLabel(tree: ProjectTree, project: Project): string {
  return [...ancestorsOf(tree, project.id).map((p) => p.name), project.name].join(" › ");
}

/**
 * movingId(새로 만들면 null)를 parentId 아래에 둘 수 있는지. 안 되면 이유를 돌려준다.
 * 서버 check_parent와 같은 규칙: 완료·보관 금지, 자기 자신·하위 금지, 3단계 초과 금지.
 */
export function cannotNest(tree: ProjectTree, movingId: string | null, parentId: string): string | null {
  const parent = tree.byId.get(parentId);
  if (!parent) return "상위 프로젝트를 찾을 수 없어요.";
  if (categoryOf(parent.status) !== "active") return "완료하거나 보관한 프로젝트 안에는 넣을 수 없어요.";
  if (movingId) {
    if (movingId === parentId) return "자기 자신 안에는 넣을 수 없어요.";
    if (descendantsOf(tree, movingId).some((d) => d.id === parentId)) return "자기 하위 프로젝트 안으로는 옮길 수 없어요.";
    if (tree.byId.get(movingId)?.parent_id === parentId) return "이미 그 안에 있어요.";
  }
  const height = movingId ? heightOf(tree, movingId) : 0;
  if (depthOf(tree, parentId) + 1 + height > MAX_PROJECT_DEPTH) return `프로젝트는 ${MAX_PROJECT_DEPTH}단계까지만 만들 수 있어요.`;
  return null;
}

/** 상위로 고를 수 있는 프로젝트 (경로 이름순) */
export function parentOptions(tree: ProjectTree, movingId: string | null): { project: Project; label: string }[] {
  return [...tree.byId.values()]
    .filter((p) => cannotNest(tree, movingId, p.id) === null || (movingId !== null && tree.byId.get(movingId)?.parent_id === p.id))
    .map((p) => ({ project: p, label: pathLabel(tree, p) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
}

/**
 * 목록 화면 구역(진행 중/완료/보관함)에 카드로 보일 프로젝트:
 * 그 구역 상태이면서, 상위가 없거나 상위가 다른 구역에 있는 것. (같은 구역의 하위는 상위 카드 안에서 보인다)
 * 이렇게 하면 어떤 프로젝트도 목록에서 사라지지 않는다.
 */
export function sectionRoots(tree: ProjectTree, category: Category): Project[] {
  return [...tree.byId.values()].filter((p) => {
    if (categoryOf(p.status) !== category) return false;
    const parent = p.parent_id ? tree.byId.get(p.parent_id) : undefined;
    return !parent || categoryOf(parent.status) !== category;
  });
}

/** 업무를 옮길 수 있는 프로젝트(진행 중)를 경로 이름과 함께 */
export function activeProjectOptions(projects: Project[]): { id: string; label: string }[] {
  const tree = buildTree(projects);
  return projects
    .filter((p) => categoryOf(p.status) === "active")
    .map((p) => ({ id: p.id, label: pathLabel(tree, p) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
}
