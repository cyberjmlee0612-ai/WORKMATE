"use client";

import { useEffect, useState } from "react";

/** 편집 모드(여러 개 선택) 상태: 켜기·끄기, 선택 토글, 결과 안내(6초 뒤 사라짐) */
export function useEditMode() {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [notice]);

  return {
    editing,
    selected,
    notice,
    start: () => {
      setNotice(null);
      setEditing(true);
    },
    stop: () => {
      setEditing(false);
      setSelected(new Set());
    },
    finish: (message: string) => {
      setNotice(message);
      setEditing(false);
      setSelected(new Set());
    },
    toggle: (id: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    setAll: (ids: string[]) => setSelected(new Set(ids)),
  };
}
