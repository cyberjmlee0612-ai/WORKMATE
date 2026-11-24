import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/** 클라이언트 컴포넌트용 Supabase 클라이언트. 세션은 쿠키에 저장되어 proxy·서버와 공유된다. */
export function createClient() {
  const { url, key } = getSupabaseEnv();
  return createBrowserClient(url, key);
}
