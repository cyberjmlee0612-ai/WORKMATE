"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * 프로젝트·업무를 '폴더에 넣듯' 끌어다 놓기 (2026-11-26 사용자 요청).
 * 브라우저 기본 끌어놓기(HTML5 DnD)를 쓴다 — 마우스용. 터치·키보드는 '업무 이동'·'상위 프로젝트' 선택으로 같은 일을 한다.
 * dragover 중에는 끌고 있는 데이터를 읽을 수 없어서, 지금 끄는 항목을 모듈 변수로 들고 있는다.
 */
/**
 * ids: 함께 끄는 항목들 (편집 모드에서 여러 개 고른 뒤 하나를 끌면 고른 것 전부 — 2026-11-26 사용자 요청)
 * name: 화면에 보일 이름 ("업무 3개" 또는 제목)
 * fromProjectIds: 업무들이 지금 속한 프로젝트 (모두 같은 곳에 다시 놓기 방지)
 */
export type DragItem = { kind: "project" | "task"; ids: string[]; name: string; fromProjectIds?: (string | null)[] };

let current: DragItem | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function startDrag(event: React.DragEvent, item: DragItem) {
  current = item;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.name); // 일부 브라우저는 데이터가 없으면 끌기를 시작하지 않는다
  if (item.ids.length > 1) {
    // 여러 개를 끌 때는 "업무 3개" 묶음 모양을 커서에 붙인다
    const ghost = document.createElement("div");
    ghost.textContent = item.name;
    Object.assign(ghost.style, {
      position: "fixed", top: "-1000px", left: "-1000px", padding: "8px 14px", borderRadius: "12px",
      background: "var(--primary)", color: "white", fontSize: "13px", fontWeight: "700",
      boxShadow: "4px 4px 0 var(--soft-sage), 8px 8px 0 var(--pale-green)",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 16, 16);
    window.setTimeout(() => ghost.remove(), 0);
  }
  emit();
}

export function endDrag() {
  current = null;
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** 지금 끌고 있는 항목 (화면에 '꺼내기' 영역 등을 보여줄 때) */
export function useDragItem(): DragItem | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

export type DropState = "idle" | "valid" | "invalid";

/**
 * 놓을 수 있는 곳. accept는 놓을 수 없으면 이유(문장), 놓을 수 있으면 null.
 * 놓으면 onDrop(항목, 놓은 화면 좌표, 대상 요소).
 */
export function useDropTarget(accept: (item: DragItem) => string | null, onDrop: (item: DragItem, point: { x: number; y: number }, target: HTMLElement) => void) {
  const [state, setState] = useState<DropState>("idle");
  const [reason, setReason] = useState<string | null>(null);

  const check = (event: React.DragEvent) => {
    const item = current;
    if (!item) return;
    const why = accept(item);
    if (why === "") return; // 빈 문자열 = 반응하지 않음 (예: 자기 자신 위)
    if (why === null) {
      event.preventDefault(); // 놓기 허용
      event.dataTransfer.dropEffect = "move";
      if (state !== "valid") setState("valid");
    } else {
      event.dataTransfer.dropEffect = "none";
      if (state !== "invalid") {
        setState("invalid");
        setReason(why);
      }
    }
  };

  return {
    state,
    reason,
    props: {
      onDragEnter: check,
      onDragOver: check,
      onDragLeave: (event: React.DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setState("idle");
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        setState("idle");
        const item = current;
        endDrag();
        if (item && accept(item) === null) onDrop(item, { x: event.clientX, y: event.clientY }, event.currentTarget);
      },
    },
  };
}

/** 놓은 자리에서 대상 폴더 가운데로 작아지며 빨려 들어가는 효과 + 대상이 살짝 튕긴다 */
export function flyInto(from: { x: number; y: number }, target: HTMLElement, label: string) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rect = target.getBoundingClientRect();
  if (!reduce) {
    const chip = document.createElement("div");
    chip.textContent = label;
    Object.assign(chip.style, {
      position: "fixed",
      left: `${from.x}px`,
      top: `${from.y}px`,
      zIndex: "100",
      maxWidth: "14rem",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      padding: "6px 12px",
      borderRadius: "12px",
      background: "var(--surface)",
      border: "2px solid var(--primary)",
      color: "var(--primary-dark)",
      fontSize: "13px",
      fontWeight: "600",
      boxShadow: "0 8px 24px rgb(0 0 0 / 0.15)",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(chip);
    const dx = rect.left + rect.width / 2 - from.x;
    const dy = rect.top + rect.height / 2 - from.y;
    chip
      .animate(
        [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.12)`, opacity: 0.1 },
        ],
        { duration: 420, easing: "cubic-bezier(0.55, 0, 0.75, 0.2)" },
      )
      .finished.finally(() => chip.remove());
  }
  target.animate([{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }], { duration: 280, delay: reduce ? 0 : 360, easing: "ease-out" });
}
