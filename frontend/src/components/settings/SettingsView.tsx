"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CircleAlert, CircleCheck, Clock, KeyRound, LoaderCircle, LogOut, ShieldAlert, Sparkles, Trash2, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ErrorState } from "@/components/common/QueryStates";
import { aiKeys, getAiUsage } from "@/lib/api/ai";
import { ApiError } from "@/lib/api/client";
import { DISPLAY_NAME_MAX, MIN_PASSWORD_LENGTH, getSettings, saveSettings, settingsKeys, type UserSettings } from "@/lib/api/settings";
import { userTimeZone } from "@/lib/date";
import { createClient } from "@/lib/supabase/client";
import { DeleteAccountDialog } from "./DeleteAccountDialog";
import { ScheduleEditor } from "./ScheduleEditor";
import { AlertSettings } from "@/components/layout/AlertSettings";
import { inputClass } from "./styles";

const primaryButton = "flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60";

export function SettingsView() {
  const query = useQuery({ queryKey: settingsKeys.all, queryFn: getSettings });
  if (query.isError) return <div className="mt-6"><ErrorState message={query.error.message} onRetry={() => query.refetch()} retrying={query.isRefetching} /></div>;
  if (!query.data) {
    return (
      <div className="mt-6 space-y-5" aria-busy="true" aria-label="불러오는 중">
        {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-48 animate-pulse rounded-[20px] bg-pale-green/40" />)}
      </div>
    );
  }
  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <ProfileSection settings={query.data} />
      <AiUsageSection />
      <Section icon={BellRing} title="알림" description="계획한 시간에 맞춰 시작·마무리를 도와줘요.">
        <AlertSettings />
      </Section>
      <div className="lg:col-span-2">
        <Section icon={Clock} title="시간표 (요일별 반복)" description="일·공부 시간, 학교·학원 같은 수업·고정 일정, 쉬는 시간을 요일마다 정해요. 캘린더에 배경으로 보이고, AI 하루 계획은 일·공부 시간에만 업무를 넣어요.">
          <ScheduleEditor />
        </Section>
      </div>
      <SecuritySection email={query.data.email} />
      <DangerSection email={query.data.email} />
    </div>
  );
}

function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveSettings,
    onSuccess: (saved) => queryClient.setQueryData(settingsKeys.all, saved),
  });
}

function ProfileSection({ settings }: { settings: UserSettings }) {
  const id = useId();
  const [name, setName] = useState(settings.display_name ?? "");
  const [done, setDone] = useState(false);
  const save = useSaveSettings();
  const fieldError = save.error instanceof ApiError ? save.error.fieldErrors.display_name : undefined;
  const changed = name.trim() !== (settings.display_name ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    save.mutate({ display_name: name.trim() || null }, { onSuccess: () => setDone(true) });
  }

  return (
    <Section icon={UserRound} title="프로필" description="대시보드 인사말에 이 이름이 쓰여요.">
      <form onSubmit={submit} noValidate>
        <p className="text-sm font-medium">이메일</p>
        <p className="mt-1.5 min-h-11 content-center rounded-xl bg-pale-green/50 px-3.5 text-[15px] text-muted">{settings.email ?? "알 수 없음"}</p>
        <label htmlFor={`${id}-name`} className="mt-4 block text-sm font-medium">표시 이름 <span className="font-normal text-muted">(선택)</span></label>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDone(false);
          }}
          maxLength={DISPLAY_NAME_MAX}
          placeholder="예: 정민"
          autoComplete="nickname"
          aria-invalid={Boolean(fieldError)}
          aria-describedby={`${id}-name-help`}
          className={inputClass(Boolean(fieldError))}
        />
        <p id={`${id}-name-help`} className={`mt-1 text-xs ${fieldError ? "font-semibold text-red-700" : "text-muted"}`}>
          {fieldError ?? `${DISPLAY_NAME_MAX}자 이내. 비워 두면 이름 없이 인사해요.`}
        </p>
        <SaveRow pending={save.isPending} disabled={!changed} done={done} error={save.isError && !fieldError ? save.error.message : null} />
      </form>
    </Section>
  );
}

function AiUsageSection() {
  const [tz] = useState(userTimeZone);
  const query = useQuery({ queryKey: aiKeys.usage(tz), queryFn: () => getAiUsage(tz) });
  const usage = query.data;
  return (
    <Section icon={Sparkles} title="AI 사용 현황" description="업무 나누기·하루 계획·리포트 회고가 하루 한도를 함께 써요.">
      {!usage ? (
        <div className="h-20 animate-pulse rounded-xl bg-pale-green/40" />
      ) : !usage.configured ? (
        <p className="text-sm text-amber-900">AI 기능이 아직 설정되지 않았어요.</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-geist text-[26px] font-bold leading-none text-primary-dark">{usage.used}<span className="text-base font-semibold text-muted"> / {usage.limit}회</span></p>
            <p className="text-sm text-muted">오늘 {usage.remaining}회 남음</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-pale-green" role="progressbar" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={usage.used} aria-label="오늘 AI 사용량">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">내 시간대 기준 자정에 다시 채워져요. 실패한 요청은 세지 않아요. 모델: {usage.model ?? "-"}</p>
        </>
      )}
      <div className="mt-4 rounded-xl bg-pale-green/50 p-3.5 text-xs leading-5 text-muted">
        <p className="flex items-center gap-1.5 font-semibold text-primary-dark"><ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />Google Gemini API로 전송되는 정보</p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
          <li>업무 나누기: 입력한 문장, 고른 프로젝트의 이름·설명·업무 제목</li>
          <li>하루 계획: 남은 업무의 제목·프로젝트·우선순위·마감일·예상 시간, 그날 일정, 요청 메모</li>
          <li>리포트 회고: 기간의 시간·완료 수치, 업무 제목·프로젝트 이름</li>
        </ul>
        <p className="mt-1.5">무료 등급에서는 Google이 서비스 개선에 사용할 수 있어요. AI는 버튼을 누를 때만 호출돼요.</p>
      </div>
    </Section>
  );
}

function SecuritySection({ email }: { email: string | null }) {
  const id = useId();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ field: "current" | "next" | "confirm" | null; message: string } | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setDone(false);
    if (!current) return setError({ field: "current", message: "현재 비밀번호를 입력해 주세요." });
    if (next.length < MIN_PASSWORD_LENGTH) return setError({ field: "next", message: `새 비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.` });
    if (next === current) return setError({ field: "next", message: "지금 비밀번호와 다른 비밀번호를 입력해 주세요." });
    if (next !== confirm) return setError({ field: "confirm", message: "새 비밀번호가 서로 일치하지 않아요." });
    if (!email) return setError({ field: null, message: "계정 이메일을 알 수 없어요. 다시 로그인해 주세요." });
    setError(null);
    setPending(true);
    try {
      const supabase = createClient();
      // 현재 비밀번호를 먼저 확인한다 (자리를 비운 사이 다른 사람이 바꾸지 못하게)
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) return setError({ field: "current", message: "현재 비밀번호가 맞지 않아요." });
      const { error: updateError } = await supabase.auth.updateUser({ password: next });
      if (updateError) {
        const message = updateError.code === "weak_password" ? "더 강한 비밀번호를 입력해 주세요." : updateError.code === "same_password" ? "지금 비밀번호와 다른 비밀번호를 입력해 주세요." : "비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.";
        return setError({ field: "next", message });
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch {
      setError({ field: null, message: "서버에 연결할 수 없어요. 네트워크 상태를 확인해 주세요." });
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const { error: signOutError } = await createClient().auth.signOut();
    if (signOutError) return setLoggingOut(false);
    router.replace("/login");
    router.refresh();
  }

  const field = (key: "current" | "next" | "confirm", label: string, value: string, onChange: (v: string) => void, autoComplete: string, help?: string) => (
    <div className="mt-3 first:mt-0">
      <label htmlFor={`${id}-${key}`} className="block text-sm font-medium">{label}</label>
      <input
        id={`${id}-${key}`}
        type="password"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setDone(false);
        }}
        autoComplete={autoComplete}
        disabled={pending}
        aria-invalid={error?.field === key}
        aria-describedby={error?.field === key || help ? `${id}-${key}-help` : undefined}
        className={inputClass(error?.field === key)}
      />
      {(error?.field === key || help) && (
        <p id={`${id}-${key}-help`} className={`mt-1 text-xs ${error?.field === key ? "font-semibold text-red-700" : "text-muted"}`}>{error?.field === key ? error.message : help}</p>
      )}
    </div>
  );

  return (
    <Section icon={KeyRound} title="계정 보안" description="비밀번호를 바꾸거나 이 기기에서 로그아웃해요.">
      <form onSubmit={submit} noValidate>
        {/* 비밀번호 관리자가 계정을 알아보도록 이메일을 숨겨 둔다 */}
        <input type="email" name="username" autoComplete="username" value={email ?? ""} readOnly hidden />
        {field("current", "현재 비밀번호", current, setCurrent, "current-password")}
        {field("next", "새 비밀번호", next, setNext, "new-password", `${MIN_PASSWORD_LENGTH}자 이상`)}
        {field("confirm", "새 비밀번호 확인", confirm, setConfirm, "new-password")}
        {error?.field === null && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{error.message}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} aria-busy={pending} className={primaryButton}>
            {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            {pending ? "바꾸는 중…" : "비밀번호 바꾸기"}
          </button>
          {done && <span className="flex items-center gap-1.5 text-sm font-semibold text-primary" role="status"><CircleCheck size={16} strokeWidth={2} aria-hidden="true" />비밀번호를 바꿨어요</span>}
        </div>
      </form>
      <div className="mt-5 border-t border-border pt-4">
        <button type="button" onClick={logout} disabled={loggingOut} aria-busy={loggingOut} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
          <LogOut size={18} strokeWidth={2} aria-hidden="true" />
          {loggingOut ? "로그아웃 중…" : "로그아웃"}
        </button>
      </div>
    </Section>
  );
}

function DangerSection({ email }: { email: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="surface-card rounded-[20px] border-red-200 p-4 md:p-5 lg:p-6" aria-labelledby="danger-heading">
      <h2 id="danger-heading" className="flex items-center gap-2 text-lg font-bold text-red-800">
        <Trash2 size={20} strokeWidth={2} aria-hidden="true" />
        계정 삭제
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        계정과 모든 프로젝트·업무·시간 기록·계획·메모·설정이 <strong className="font-semibold text-red-800">바로, 되돌릴 수 없게</strong> 지워져요.
      </p>
      <button type="button" onClick={() => setOpen(true)} disabled={!email} className="mt-4 flex min-h-11 items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60">
        <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
        계정 삭제하기
      </button>
      {open && email && <DeleteAccountDialog email={email} onClose={() => setOpen(false)} />}
    </section>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return (
    <section className="surface-card rounded-[20px] p-4 md:p-5 lg:p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold text-primary-dark">
        <span className="flex size-9 items-center justify-center rounded-xl bg-pale-green"><Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SaveRow({ pending, disabled, done, error }: { pending: boolean; disabled: boolean; done: boolean; error: string | null }) {
  return (
    <div className="mt-4">
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
          <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || disabled} aria-busy={pending} className={primaryButton}>
          {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
          {pending ? "저장 중…" : "저장"}
        </button>
        {done && <span className="flex items-center gap-1.5 text-sm font-semibold text-primary" role="status"><CircleCheck size={16} strokeWidth={2} aria-hidden="true" />저장했어요</span>}
      </div>
    </div>
  );
}
