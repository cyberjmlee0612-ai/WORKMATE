import type { ReactNode } from "react";
import { CircleAlert, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function ErrorState({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-red-200 bg-red-50/60 px-4 py-10 text-center" role="alert">
      <CircleAlert size={24} strokeWidth={2} className="text-red-700" aria-hidden="true" />
      <p className="mt-3 text-sm text-red-800">{message}</p>
      <button type="button" onClick={onRetry} disabled={retrying} className="mt-4 flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
        <RotateCw size={16} strokeWidth={2} className={retrying ? "animate-spin" : ""} aria-hidden="true" />
        다시 시도
      </button>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-soft-sage px-4 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-pale-green text-primary-dark">
        <Icon size={24} strokeWidth={2} aria-hidden="true" />
      </span>
      <p className="mt-4 text-base font-semibold text-primary-dark">{title}</p>
      <p className="mt-1 text-sm text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-[196px] animate-pulse rounded-2xl border border-border bg-pale-green/40" />
      ))}
    </div>
  );
}
