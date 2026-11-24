import { CalendarClock, CalendarDays, TriangleAlert } from "lucide-react";
import { dueStatus } from "@/lib/date";
import { formatDate } from "@/lib/format";

/** 마감일 표시. 지연·오늘·내일은 텍스트 + 아이콘 + 강조로 함께 알린다 (색만으로 전달하지 않음). */
export function DueLabel({ dueDate, today, completed }: { dueDate: string | null; today: string | null; completed: boolean }) {
  const date = formatDate(dueDate);
  if (!date) {
    return (
      <span className="inline-flex items-center gap-1">
        <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
        마감일 없음
      </span>
    );
  }

  const status = dueStatus(dueDate, today, completed);
  if (status === "overdue") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 font-semibold text-red-800">
        <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
        지연 · {date}
      </span>
    );
  }
  if (status === "today" || status === "tomorrow") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-pale-green px-1.5 py-0.5 font-semibold text-primary-dark">
        <CalendarClock size={14} strokeWidth={2} aria-hidden="true" />
        {status === "today" ? "오늘 마감" : "내일 마감"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
      마감 {date}
    </span>
  );
}
