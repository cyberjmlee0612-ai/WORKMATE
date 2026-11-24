import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

/** 로그인 없이 접근 가능한 경로 */
const PUBLIC_PATHS = ["/login", "/signup", "/auth"];
/** 로그인한 사용자가 오면 대시보드로 보낼 경로 */
const AUTH_PAGES = ["/login", "/signup"];

function matches(pathname: string, paths: string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * 세션 쿠키를 갱신하고, 비로그인 사용자를 /login으로 보낸다.
 * 화면 이동을 위한 낙관적 검사일 뿐이며, 실제 데이터 보호는 FastAPI 토큰 검증과 RLS가 담당한다.
 */
export async function updateSession(request: NextRequest) {
  const { url, key } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // 갱신된 토큰을 요청(이후 서버 렌더링)과 응답(브라우저) 양쪽에 반영해야 세션이 풀리지 않는다
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // createServerClient와 getClaims 사이에 다른 코드를 넣지 않는다 (세션 갱신 타이밍 문제 방지)
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;

  if (!isLoggedIn && !matches(pathname, PUBLIC_PATHS)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectWithCookies(loginUrl, response);
  }

  if (isLoggedIn && matches(pathname, AUTH_PAGES)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return redirectWithCookies(homeUrl, response);
  }

  return response;
}

/** 리다이렉트 응답에도 갱신된 세션 쿠키를 옮겨 담는다 */
function redirectWithCookies(target: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(target);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
