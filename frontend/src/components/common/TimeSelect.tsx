"use client";

/**
 * 시·분(10분 단위) 선택 칸. 값은 "HH:MM".
 * 브라우저 기본 시각 입력칸은 오전/오후 표시·step 처리가 브라우저마다 달라 12:00(오후 12시)을 고르기 어려운 경우가 있어
 * (2026-11-26 사용자 제보) 두 개의 선택 칸으로 바꿨다. allow24면 끝 시각으로 24:00(자정)도 고를 수 있다.
 */
type Props = {
  value: string;
  onChange: (value: string) => void;
  label: string; // 접근 가능한 이름 (예: "일 시작")
  allow24?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = [0, 10, 20, 30, 40, 50];
const pad = (n: number) => String(n).padStart(2, "0");

export function TimeSelect({ value, onChange, label, allow24 = false, disabled, invalid, className = "" }: Props) {
  const [h, m] = (value || "00:00").split(":").map(Number);
  const hours = allow24 ? [...HOURS, 24] : HOURS;
  const minutes = MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort((a, b) => a - b); // 10분 단위가 아닌 기존 값도 보이게
  const select = `min-h-11 rounded-xl border bg-surface px-2 text-[15px] text-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60 ${invalid ? "border-red-400" : "border-border focus:border-primary"}`;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} role="group" aria-label={label}>
      <select
        aria-label={`${label} 시`}
        value={h}
        disabled={disabled}
        onChange={(e) => {
          const nextH = Number(e.target.value);
          onChange(`${pad(nextH)}:${nextH === 24 ? "00" : pad(m)}`);
        }}
        className={select}
      >
        {hours.map((hour) => <option key={hour} value={hour}>{pad(hour)}시</option>)}
      </select>
      <select aria-label={`${label} 분`} value={m} disabled={disabled || h === 24} onChange={(e) => onChange(`${pad(h)}:${pad(Number(e.target.value))}`)} className={select}>
        {minutes.map((minute) => <option key={minute} value={minute}>{pad(minute)}분</option>)}
      </select>
    </span>
  );
}
