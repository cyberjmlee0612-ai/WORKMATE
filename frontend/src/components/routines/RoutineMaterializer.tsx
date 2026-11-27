"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { materializeRoutines, routineKeys } from "@/lib/api/routines";
import { useToday, userTimeZone } from "@/lib/date";

const KEY = "workmate.routines.materialized";

/**
 * 그날 처음 열 때 오늘 반복 업무를 만들고, 지난 날 하지 않은 반복 업무를 '건너뜀'으로 정리한다 (2026-11-27 사용자 확정).
 * 탭마다 하루 한 번 (서버도 중복 없이 처리하므로 여러 탭·기기에서 불러도 안전). 화면에는 아무것도 그리지 않는다.
 */
export function RoutineMaterializer() {
  const today = useToday();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!today) return;
    try {
      if (window.sessionStorage.getItem(KEY) === today) return;
    } catch {
      // 저장소를 못 쓰면 매번 불러도 결과는 같다
    }
    let cancelled = false;
    materializeRoutines(userTimeZone())
      .then((result) => {
        if (cancelled) return;
        try {
          window.sessionStorage.setItem(KEY, today);
        } catch {
          // 무시
        }
        if (result.created > 0 || result.skipped > 0) {
          invalidateWorkData(queryClient);
          queryClient.invalidateQueries({ queryKey: routineKeys.all });
        }
      })
      .catch(() => {
        // 다음에 다시 열 때 시도한다 (로그인 만료 등은 apiFetch가 처리)
      });
    return () => {
      cancelled = true;
    };
  }, [today, queryClient]);

  return null;
}
