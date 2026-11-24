export function ProgressBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-pale-green" role="meter" aria-label={label} aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${clamped}%` }} />
    </div>
  );
}
