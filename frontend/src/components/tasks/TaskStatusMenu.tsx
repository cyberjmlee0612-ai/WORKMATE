"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, ChevronDown, LoaderCircle } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { TASK_STATUSES, TASK_STATUS_LABEL, updateTask, type ActiveTaskStatus, type Task } from "@/lib/api/tasks";
import { STATUS_ICON, statusTone } from "./TaskBadges";

type Props = {
  task: Task;
  /** '업무에서 제외'를 고르면 사유 입력 창을 연다 */
  onRequestCancel: () => void;
  onError: (message: string | null) => void;
};

const GAP = 6; // 배지와 메뉴 사이
const EDGE = 8; // 화면 가장자리 여백

/** 화면 하단에 고정된 모바일 메뉴의 높이 (보이지 않으면 0) */
function bottomNavHeight() {
  const nav = document.querySelector<HTMLElement>('nav[aria-label="모바일 메뉴"]');
  if (!nav || getComputedStyle(nav).display === "none") return 0;
  return nav.getBoundingClientRect().height;
}

/**
 * 상태 배지를 누르면 메뉴가 열리고, 고르면 바로 저장한다(수정 창 없이).
 * 제외된 업무에서 다른 상태를 고르면 다시 활성 업무로 돌아온다.
 *
 * 메뉴는 body에 포털로 띄운다. 목록 행 안에 두면 카드·행의 쌓임 맥락(opacity 등)과
 * 모바일 하단 메뉴(fixed)에 가려 아래쪽 항목을 고를 수 없기 때문이다.
 */
export function TaskStatusMenu({ task, onRequestCancel, onError }: Props) {
  const queryClient = useQueryClient();
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const cancelled = task.status === "cancelled";

  const mutation = useMutation({
    mutationFn: (status: ActiveTaskStatus) => updateTask(task.id, { status }),
    onMutate: () => onError(null),
    onSuccess: () => invalidateWorkData(queryClient),
    onError: (error) => {
      const notFound = error instanceof ApiError && error.status === 404;
      onError(notFound ? "이미 삭제된 업무입니다. 목록을 새로고침했어요." : error instanceof ApiError ? error.message : "상태를 저장하지 못했습니다. 다시 시도해 주세요.");
      if (notFound) invalidateWorkData(queryClient);
    },
  });
  const pending = mutation.isPending;

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? []);

  function close(returnFocus = true) {
    setOpen(false);
    setPosition(null);
    if (returnFocus) buttonRef.current?.focus();
  }

  // 메뉴를 실제로 그린 뒤 높이를 재서 위치를 정한다 (그리기 전에는 보이지 않게 둔다)
  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const menuHeight = menu.scrollHeight;
    const menuWidth = menu.offsetWidth;

    const spaceBelow = window.innerHeight - bottomNavHeight() - anchor.bottom - GAP - EDGE;
    const spaceAbove = anchor.top - GAP - EDGE;
    const left = Math.min(Math.max(anchor.left, EDGE), window.innerWidth - menuWidth - EDGE);

    let next: CSSProperties;
    if (menuHeight <= spaceBelow) {
      next = { top: anchor.bottom + GAP, left };
    } else if (menuHeight <= spaceAbove) {
      next = { top: anchor.top - GAP - menuHeight, left };
    } else if (spaceBelow >= spaceAbove) {
      // 어느 쪽도 다 들어가지 않으면 넓은 쪽에 붙이고 메뉴 안에서 스크롤
      next = { top: anchor.bottom + GAP, left, maxHeight: spaceBelow, overflowY: "auto" };
    } else {
      next = { top: EDGE, left, maxHeight: spaceAbove, overflowY: "auto" };
    }
    setPosition(next);
  }, [open]);

  // 위치가 정해지면 현재 상태 항목에 포커스
  useEffect(() => {
    if (!open || !position) return;
    const current = menuRef.current?.querySelector<HTMLElement>("[aria-checked='true']") ?? items()[0];
    current?.focus({ preventScroll: true });
  }, [open, position]);

  // 바깥을 누르거나, 스크롤·크기 변경으로 배지 위치가 바뀌면 닫는다
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    }
    function onViewportChange(event: Event) {
      if (event.type === "scroll" && menuRef.current?.contains(event.target as Node)) return; // 메뉴 안 스크롤은 무시
      close(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") close(false);
  }

  function choose(status: ActiveTaskStatus) {
    close();
    if (status !== task.status) mutation.mutate(status);
  }

  const Icon = STATUS_ICON[task.status];

  const menu = (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label="진행 상황 변경"
      onKeyDown={onMenuKeyDown}
      // 모바일 하단 메뉴(z-40)보다 위. 위치가 정해지기 전에는 숨겨서 깜빡임 방지
      style={{ position: "fixed", visibility: position ? "visible" : "hidden", top: 0, left: 0, ...position }}
      className="surface-card z-50 w-44 rounded-xl p-1.5 shadow-[var(--floating-shadow)]"
    >
      {cancelled && <p className="px-2.5 pb-1.5 pt-1 text-xs text-muted">상태를 고르면 다시 업무에 포함돼요.</p>}
      {TASK_STATUSES.map((status) => {
        const ItemIcon = STATUS_ICON[status];
        const current = status === task.status;
        return (
          <button
            key={status}
            type="button"
            role="menuitemradio"
            aria-checked={current}
            tabIndex={-1}
            onClick={() => choose(status)}
            className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm focus:bg-pale-green focus:outline-none hover:bg-pale-green ${current ? "font-semibold text-primary-dark" : "text-foreground"}`}
          >
            <ItemIcon size={16} strokeWidth={2} className="text-primary" aria-hidden="true" />
            <span className="flex-1">{TASK_STATUS_LABEL[status]}</span>
            {current && <Check size={16} strokeWidth={2.5} className="text-primary" aria-hidden="true" />}
          </button>
        );
      })}
      {!cancelled && (
        <>
          <div className="my-1 border-t border-border" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              close(false);
              onRequestCancel();
            }}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-muted hover:bg-background hover:text-foreground focus:bg-background focus:outline-none"
          >
            <Ban size={16} strokeWidth={2} aria-hidden="true" />
            업무에서 제외…
          </button>
        </>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close(false) : !pending && setOpen(true))}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={pending}
        aria-label={`상태: ${TASK_STATUS_LABEL[task.status]}. 눌러서 변경`}
        className={`inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-shadow hover:shadow-[0_0_0_2px_var(--soft-sage)] disabled:cursor-wait ${statusTone(task.status)}`}
      >
        {pending ? <LoaderCircle size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Icon size={14} strokeWidth={2} aria-hidden="true" />}
        {TASK_STATUS_LABEL[task.status]}
        <ChevronDown size={12} strokeWidth={2.5} aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(menu, document.body)}
    </>
  );
}
