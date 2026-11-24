"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";

export function Providers({ children }: { children: ReactNode }) {
  // 요청마다(서버) / 탭마다(브라우저) 별도 인스턴스가 되도록 state로 만든다
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // 4xx(없음·권한·검증)는 다시 시도해도 결과가 같으므로 재시도하지 않는다
            retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
          },
          mutations: { retry: false }, // 저장 요청은 자동 재시도하지 않는다 (중복 생성 방지)
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
