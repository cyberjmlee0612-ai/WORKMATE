import type { QueryClient } from "@tanstack/react-query";
import { dashboardKeys } from "./dashboard";
import { projectKeys } from "./projects";
import { taskKeys } from "./tasks";
import { timeKeys } from "./time";

/**
 * 업무·프로젝트가 바뀐 뒤 호출. 서버 저장이 성공한 다음 관련 데이터를 다시 조회한다.
 * 업무 하나가 바뀌어도 업무 목록, 프로젝트 진행률, 대시보드 KPI가 모두 달라지므로 함께 무효화한다.
 * 시간 기록도 포함: 업무를 완료·제외하면 타이머가 멈추고, 삭제하면 기록이 함께 지워진다.
 */
export function invalidateWorkData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: timeKeys.all }),
    queryClient.invalidateQueries({ queryKey: taskKeys.all }),
    queryClient.invalidateQueries({ queryKey: projectKeys.all }),
    queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
  ]);
}
