"use client";

import { useState } from "react";
import { browserPermission, setAlertPrefs, useAlertPrefs } from "@/lib/alerts";

/** 계획 알림 켜기/끄기 + 브라우저 알림 권한 (알림 센터·설정 화면 공통) */
export function AlertSettings() {
  const prefs = useAlertPrefs();
  // 권한은 버튼을 누른 뒤 바뀌므로 화면 상태로 따라간다
  const [permission, setPermission] = useState(browserPermission);

  async function enableBrowser() {
    if (permission === "unsupported") return;
    const result = permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(result);
    setAlertPrefs({ browser: result === "granted" });
  }

  return (
    <div className="space-y-2 text-sm">
      <label className="flex min-h-11 items-center justify-between gap-3">
        <span>
          <span className="block font-medium text-foreground">계획 시작 알림</span>
          <span className="block text-xs text-muted">5분 전·시작할 때, 계획이 끝나면 타이머를 멈출지 물어봐요</span>
        </span>
        <input type="checkbox" checked={prefs.enabled} onChange={(e) => setAlertPrefs({ enabled: e.target.checked })} className="size-5 shrink-0 accent-[var(--color-primary)]" />
      </label>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <span>
          <span className="block font-medium text-foreground">브라우저 알림</span>
          <span className="block text-xs text-muted">
            {permission === "unsupported"
              ? "이 브라우저는 알림을 지원하지 않아요."
              : permission === "denied"
                ? "알림이 차단돼 있어요. 브라우저 주소창의 사이트 설정에서 허용해 주세요."
                : "다른 탭을 보고 있어도 알려 줘요 (WORKMATE 탭은 열려 있어야 해요)"}
          </span>
        </span>
        {permission === "granted" ? (
          <input type="checkbox" checked={prefs.browser} disabled={!prefs.enabled} onChange={(e) => setAlertPrefs({ browser: e.target.checked })} className="size-5 shrink-0 accent-[var(--color-primary)]" aria-label="브라우저 알림" />
        ) : permission === "default" ? (
          <button type="button" onClick={enableBrowser} disabled={!prefs.enabled} className="min-h-10 shrink-0 rounded-lg border border-border px-3 text-xs font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
            허용하기
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">이 설정은 지금 쓰는 기기(브라우저)에만 저장돼요.</p>
    </div>
  );
}
