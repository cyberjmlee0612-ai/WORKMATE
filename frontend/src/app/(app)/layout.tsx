import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";

/** 로그인 후 화면 공통 레이아웃: 사이드바 + 모바일 하단 메뉴 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
