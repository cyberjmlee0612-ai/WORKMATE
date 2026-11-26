import { useSyncExternalStore } from "react";

/**
 * 계획 알림 설정 (2026-11-26 사용자 확정: 우선 앱 알림 + 브라우저 알림, 추후 웹 푸시로 바꿀 수 있게).
 * 기기(브라우저)마다 따로 저장한다. 웹 푸시로 바꾸면 서버 저장으로 옮긴다.
 */
export type AlertPrefs = { enabled: boolean; browser: boolean };
const KEY = "workmate.alerts";
const DEFAULT: AlertPrefs = { enabled: true, browser: false };
const listeners = new Set<() => void>();
let cache: AlertPrefs | null = null;

function read(): AlertPrefs {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<AlertPrefs>) } : DEFAULT;
  } catch {
    cache = DEFAULT;
  }
  return cache;
}

export function setAlertPrefs(patch: Partial<AlertPrefs>) {
  cache = { ...read(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // 저장이 막혀도 이번 화면에서는 적용한다
  }
  listeners.forEach((fn) => fn());
}

export function useAlertPrefs(): AlertPrefs {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => DEFAULT,
  );
}

/** 브라우저 알림 권한: "unsupported" | "default" | "granted" | "denied" */
export function browserPermission(): NotificationPermission | "unsupported" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

/** 같은 알림을 다시 띄우지 않도록 날짜별로 기억 (새로고침해도 유지) */
const SENT_PREFIX = "workmate.alerts.sent.";

export function wasSent(day: string, key: string): boolean {
  try {
    return (JSON.parse(window.localStorage.getItem(SENT_PREFIX + day) ?? "[]") as string[]).includes(key);
  } catch {
    return false;
  }
}

export function markSent(day: string, key: string) {
  try {
    const list = JSON.parse(window.localStorage.getItem(SENT_PREFIX + day) ?? "[]") as string[];
    window.localStorage.setItem(SENT_PREFIX + day, JSON.stringify([...list, key].slice(-300)));
    // 지난 날짜 기록은 정리
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(SENT_PREFIX) && k !== SENT_PREFIX + day) window.localStorage.removeItem(k);
    }
  } catch {
    // 무시
  }
}
