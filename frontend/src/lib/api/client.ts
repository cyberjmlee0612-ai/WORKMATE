import { createClient } from "@/lib/supabase/client";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: unknown,
    /** 입력 검증 오류(422)의 필드별 메시지. 예: { name: "프로젝트 이름을 입력해 주세요." } */
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getApiBaseUrl() {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL 환경변수를 설정하세요 (frontend/.env.local).");
  return baseUrl.replace(/\/$/, "");
}

/**
 * FastAPI 호출 (클라이언트 컴포넌트 전용).
 * 매 요청마다 Supabase에서 현재 access token을 꺼내 붙인다. 만료 직전이면 SDK가 먼저 갱신한다.
 * 401이면 세션이 끝난 것이므로 로그인 화면으로 보낸다.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init.headers);
  if (session) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, { ...init, headers });
  } catch (error) {
    throw new ApiError(0, "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.", error);
  }

  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}`;
    // 의도적인 전체 새로고침: 만료된 세션에서 남은 클라이언트 상태를 모두 비우고, 컴포넌트 밖에서도 호출 가능해야 한다
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    throw new ApiError(401, "로그인이 필요합니다.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    const message = typeof detail === "string" ? detail : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    throw new ApiError(response.status, message, detail, body?.errors ?? {});
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
