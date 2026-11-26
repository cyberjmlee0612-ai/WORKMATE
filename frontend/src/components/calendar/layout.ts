/** 시간표 배치 계산. 1분 = 1px (1시간 60px), 10분 단위로 맞춘다. */

export const MINUTE_PX = 1;
export const HOUR_PX = 60 * MINUTE_PX;
export const DAY_MINUTES = 24 * 60;
export const SNAP_MIN = 10;
export const DEFAULT_PLAN_MIN = 60;
export const MAX_PLAN_MIN = 24 * 60;
/** 처음 열었을 때 보여줄 시각 (2026-11-26 사용자 확정: 0~24시를 그리고 8시로 스크롤) */
export const INITIAL_SCROLL_HOUR = 8;

export const snap = (minutes: number) => Math.round(minutes / SNAP_MIN) * SNAP_MIN;
export const snapDown = (minutes: number) => Math.floor(minutes / SNAP_MIN) * SNAP_MIN;

/** 업무를 끌어다 놓을 때 기본 길이: 예상 소요 시간(10분 단위), 없으면 1시간 */
export function defaultPlanMinutes(estimated: number | null): number {
  if (!estimated) return DEFAULT_PLAN_MIN;
  return Math.min(MAX_PLAN_MIN, Math.max(SNAP_MIN, snap(estimated)));
}

export type Positioned<T> = {
  item: T;
  top: number;
  height: number;
  /** 겹친 블록끼리 칸을 나눈다: lane번째 칸 / 전체 lanes칸 */
  lane: number;
  lanes: number;
  /** 서로 겹치는 블록 묶음 번호 (묶음 단위로 폭을 정할 때 쓴다) */
  cluster: number;
  /** 화면에 보이는 구간(그날 안으로 자른 시각, epoch ms) */
  clipStart: number;
  clipEnd: number;
  /** 전날·다음 날로 이어지는 블록 */
  cutTop: boolean;
  cutBottom: boolean;
};

/**
 * 하루(dayStart~dayEnd, epoch ms)에 걸치는 블록의 위치를 계산한다.
 * 겹치는 블록 묶음마다 빈 칸에 차례로 넣어(greedy) 나란히 보여준다.
 */
export function layoutDay<T>(items: T[], range: (item: T) => [number, number], dayStart: number, dayEnd: number): Positioned<T>[] {
  const clipped = items
    .map((item) => {
      const [s, e] = range(item);
      return { item, s, e, cs: Math.max(s, dayStart), ce: Math.min(e, dayEnd) };
    })
    .filter((x) => x.ce > x.cs)
    .sort((a, b) => a.cs - b.cs || b.ce - a.ce);

  const result: Positioned<T>[] = [];
  let cluster: { pos: Positioned<T>; end: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  let clusterIndex = -1;

  const flush = () => {
    for (const c of cluster) c.pos.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
    clusterIndex += 1;
  };

  for (const x of clipped) {
    if (x.cs >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= x.cs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(x.ce);
    } else {
      laneEnds[lane] = x.ce;
    }
    clusterEnd = Math.max(clusterEnd, x.ce);
    const pos: Positioned<T> = {
      item: x.item,
      top: ((x.cs - dayStart) / 60_000) * MINUTE_PX,
      height: ((x.ce - x.cs) / 60_000) * MINUTE_PX,
      lane,
      lanes: 1,
      cluster: clusterIndex,
      clipStart: x.cs,
      clipEnd: x.ce,
      cutTop: x.s < dayStart,
      cutBottom: x.e > dayEnd,
    };
    cluster.push({ pos, end: x.ce });
    result.push(pos);
  }
  flush();
  return result;
}
