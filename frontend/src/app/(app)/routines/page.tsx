import { RoutinesView } from "@/components/routines/RoutinesView";

export default function RoutinesPage() {
  return (
    <>
      <header className="min-w-0">
        <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">Routines</p>
        <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">반복 · 습관</h1>
        <p className="mt-2 text-sm text-muted md:text-base">반복되는 일은 한 번만 정해 두고, 습관은 매일 체크해 연속 기록을 쌓아요.</p>
      </header>
      <RoutinesView />
    </>
  );
}
