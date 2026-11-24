/**
 * 로그인 후 이동할 경로를 검증한다.
 * `//evil.com`, `https://...`, `/\evil.com` 같은 외부 주소로 보내는 오픈 리다이렉트를 막는다.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
