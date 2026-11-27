import { useSyncExternalStore } from "react";

/**
 * 집중 모드 진행 상태 (브라우저에 저장 → 새로고침해도 카운트다운이 이어진다).
 * phase: focus(집중 중) → break(휴식) → ready(다음 집중 기다림). 4번째 집중 뒤 휴식은 길게.
 */
export type FocusPreset = { focus: number; short: number; long: number; every: number };
export const PRESETS: { label: string; value: FocusPreset }[] = [
  { label: "25 / 5", value: { focus: 25, short: 5, long: 15, every: 4 } },
  { label: "50 / 10", value: { focus: 50, short: 10, long: 20, every: 3 } },
  { label: "15 / 3", value: { focus: 15, short: 3, long: 10, every: 4 } },
];

export type FocusState = {
  sessionId: string | null; // 지금 집중 기록 (휴식·대기 중에는 null)
  taskId: string | null;
  taskTitle: string;
  phase: "focus" | "break" | "ready";
  endsAt: number; // 이번 단계가 끝나는 시각(ms). ready면 0
  round: number; // 끝낸 집중 횟수
  interruptions: number; // 이번 집중의 방해 횟수
  preset: FocusPreset;
  minimized: boolean;
};

const KEY = "workmate.focus";
const PRESET_KEY = "workmate.focus.preset";
const listeners = new Set<() => void>();
let cache: FocusState | null | undefined;

function read(): FocusState | null {
  if (cache !== undefined) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as FocusState) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function setFocus(next: FocusState | null) {
  cache = next;
  try {
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  } catch {
    // 저장이 막혀도 이 화면에서는 동작한다
  }
  listeners.forEach((fn) => fn());
}

export const getFocus = () => read();

/** 지금부터 minutes분 뒤 시각(ms) — 이벤트 처리·타이머 콜백에서만 쓴다 */
export const endsIn = (minutes: number) => Date.now() + minutes * 60_000;

export function useFocus(): FocusState | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      // 다른 탭에서 바꾼 상태도 따라간다
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          cache = undefined;
          fn();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(fn);
        window.removeEventListener("storage", onStorage);
      };
    },
    read,
    () => null,
  );
}

export function lastPreset(): FocusPreset {
  try {
    const raw = window.localStorage.getItem(PRESET_KEY);
    if (raw) return JSON.parse(raw) as FocusPreset;
  } catch {
    // 무시
  }
  return PRESETS[0].value;
}

export function rememberPreset(p: FocusPreset) {
  try {
    window.localStorage.setItem(PRESET_KEY, JSON.stringify(p));
  } catch {
    // 무시
  }
}

/** 집중 시작 창 열기 (업무를 미리 골라서 열 수 있다) */
export const FOCUS_OPEN_EVENT = "workmate:focus-open";
export const openFocus = (task?: { id: string; title: string }) =>
  window.dispatchEvent(new CustomEvent(FOCUS_OPEN_EVENT, { detail: task ?? null }));

// ---- 소리: 시작 버튼을 누를 때 준비해 두어야 브라우저가 나중에 재생을 허락한다
let audio: AudioContext | null = null;
export function primeAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}
export function chime() {
  if (!audio) return;
  const notes = [880, 1175];
  notes.forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    const t = audio!.currentTime + i * 0.22;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}
