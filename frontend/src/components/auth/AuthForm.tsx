"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { CircleAlert, LoaderCircle, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/auth/redirect";

type Mode = "login" | "signup";

const MIN_PASSWORD_LENGTH = 8;

const COPY = {
  login: { title: "로그인", description: "WORKMATE에 다시 오신 것을 환영해요.", submit: "로그인", pending: "로그인 중…" },
  signup: { title: "회원가입", description: "이메일로 WORKMATE를 시작해 보세요.", submit: "가입하기", pending: "가입 중…" },
} as const;

function toKoreanMessage(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    case "email_not_confirmed":
      return "이메일 인증이 완료되지 않았습니다. 받은 편지함의 인증 메일을 확인해 주세요.";
    case "user_already_exists":
    case "email_exists":
      return "이미 가입된 이메일입니다. 로그인해 주세요.";
    case "weak_password":
      return "비밀번호가 너무 약합니다. 더 길고 복잡하게 입력해 주세요.";
    case "email_address_invalid":
      return "사용할 수 없는 이메일 주소입니다.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    default:
      return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const copy = COPY[mode];
  const nextPath = safeNextPath(next);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // 중복 제출 방지
    setError(null);

    const trimmedEmail = email.trim();
    if (mode === "signup") {
      if (password.length < MIN_PASSWORD_LENGTH) return setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
      if (password !== passwordConfirm) return setError("비밀번호가 서로 일치하지 않습니다.");
    }

    setPending(true);
    const supabase = createClient();
    try {
      if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
        if (authError) return setError(toKoreanMessage(authError));
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}` },
        });
        if (authError) return setError(toKoreanMessage(authError));
        // 이메일 인증이 켜져 있고 이미 가입된 주소면 Supabase는 오류 대신 identities가 빈 사용자를 돌려준다
        if (data.user && data.user.identities?.length === 0) return setError("이미 가입된 이메일입니다. 로그인해 주세요.");
        // 이메일 인증이 켜져 있으면 세션이 없다 → 인증 안내
        if (!data.session) return setConfirmationSentTo(trimmedEmail);
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  if (confirmationSentTo) {
    return (
      <div className="text-center" role="status">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-pale-green text-primary-dark">
          <MailCheck size={24} strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-bold text-primary-dark">인증 메일을 보냈어요</h1>
        <p className="mt-3 break-all text-sm leading-6 text-muted">
          <strong className="font-semibold text-foreground">{confirmationSentTo}</strong>
          <br />
          받은 편지함에서 인증 링크를 눌러 가입을 완료해 주세요.
        </p>
        <Link href="/login" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green">
          로그인 화면으로
        </Link>
      </div>
    );
  }

  const inputClass =
    "mt-1.5 block min-h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-[15px] text-foreground placeholder:text-muted/70 focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60";

  return (
    <>
      <h1 className="text-2xl font-bold text-primary-dark">{copy.title}</h1>
      <p className="mt-1.5 text-sm text-muted">{copy.description}</p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate={false}>
        <label className="block text-sm font-medium text-foreground">
          이메일
          <input type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} className={inputClass} placeholder="you@example.com" />
        </label>
        <label className="block text-sm font-medium text-foreground">
          비밀번호
          <input
            type="password"
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? MIN_PASSWORD_LENGTH : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
            className={inputClass}
          />
          {mode === "signup" && <span className="mt-1 block text-xs text-muted">{MIN_PASSWORD_LENGTH}자 이상 입력해 주세요.</span>}
        </label>
        {mode === "signup" && (
          <label className="block text-sm font-medium text-foreground">
            비밀번호 확인
            <input type="password" name="passwordConfirm" autoComplete="new-password" required value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} disabled={pending} className={inputClass} />
          </label>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} aria-busy={pending} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-75">
          {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
          {pending ? copy.pending : copy.submit}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? "아직 계정이 없나요? " : "이미 계정이 있나요? "}
        <Link
          href={`${mode === "login" ? "/signup" : "/login"}${nextPath !== "/" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {mode === "login" ? "회원가입" : "로그인"}
        </Link>
      </p>
    </>
  );
}
