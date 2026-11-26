export const inputClass = (invalid = false) =>
  `mt-1.5 block min-h-11 w-full rounded-xl border bg-surface px-3.5 text-[15px] text-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60 ${invalid ? "border-red-400" : "border-border focus:border-primary"}`;
