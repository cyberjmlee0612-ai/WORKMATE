"use client";

import type { ReactNode } from "react";
import { useDropTarget, type DragItem } from "@/lib/dnd";
import type { ProjectTree } from "@/lib/projectTree";
import { acceptInto } from "./useNestActions";

type Props = {
  tree: ProjectTree;
  /** null = 최상위로 꺼내기 */
  targetId: string | null;
  onDrop: (item: DragItem, point: { x: number; y: number }, element: HTMLElement) => void;
  className: string | ((state: "idle" | "valid" | "invalid") => string);
  children: ReactNode;
  as?: "div" | "span";
};

/** 카드가 아닌 곳(최상위로 꺼내기 영역, 상위 경로 링크 등)을 놓을 자리로 만든다 */
export function NestDropZone({ tree, targetId, onDrop, className, children, as = "div" }: Props) {
  const drop = useDropTarget(acceptInto(tree, targetId), onDrop);
  const Tag = as;
  return (
    <Tag {...drop.props} title={drop.state === "invalid" ? (drop.reason ?? undefined) : undefined} className={typeof className === "function" ? className(drop.state) : className}>
      {children}
    </Tag>
  );
}
