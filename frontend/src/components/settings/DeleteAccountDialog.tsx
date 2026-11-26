"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { deleteAccount } from "@/lib/api/settings";
import { createClient } from "@/lib/supabase/client";
import { inputClass } from "./styles";

/**
 * 계정 삭제 확인 (되돌릴 수 없음). 이메일과 현재 비밀번호를 다시 입력하고 안내에 동의해야 삭제할 수 있다.
 * 삭제되면 이 기기의 세션도 지우고 로그인 화면으로 이동한다.
 */
export function DeleteAccountDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field: "email" | "password" | null; message: string } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const requestClose = () => {
    if (!pending) onClose();
  };
  const ready = typedEmail.trim().toLowerCase() === email.toLowerCase() && password.length > 0 && agree;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || pending) return;
    setPending(true);
    setError(null);
    try {
      await deleteAccount({ email: typedEmail.trim(), password });
    } catch (e) {
      setPending(false);
      if (e instanceof ApiError) {
        const field = e.fieldErrors.email ? "email" : e.fieldErrors.password ? "password" : null;
        setError({ field, message: (field && e.fieldErrors[field]) || e.message });
      } else {
        setError({ field: null, message: "계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요." });
      }
      return;
    }
    // 계정이 지워졌으므로 이 기기 세션과 캐시를 정리한다 (서버 세션은 이미 무효)
    await createClient().auth.signOut({ scope: "local" }).catch(() => undefined);
    queryClient.clear();
    window.location.replace("/login?deleted=1");
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-md rounded-[20px] p-5 text-foreground backdrop:bg-primary-dark/30 md:p-6"
    >
      <form onSubmit={submit} noValidate>
        <span className="flex size-11 items-center justify-center rounded-2xl bg-red-50 text-red-700">
          <Trash2 size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <h2 id={`${id}-title`} className="mt-4 text-lg font-bold text-primary-dark">계정을 삭제할까요?</h2>
        <p id={`${id}-desc`} className="mt-2 text-sm leading-6 text-muted">
          모든 프로젝트·업무·시간 기록·계획·메모·설정이 함께 지워지고 <strong className="font-semibold text-red-800">되돌릴 수 없어요.</strong> 확인을 위해 이메일과 비밀번호를 다시 입력해 주세요.
        </p>

        <label htmlFor={`${id}-email`} className="mt-4 block text-sm font-medium">
          이메일 <span className="font-normal text-muted">({email})</span>
        </label>
        <input
          id={`${id}-email`}
          type="email"
          value={typedEmail}
          onChange={(e) => setTypedEmail(e.target.value)}
          autoComplete="off"
          disabled={pending}
          aria-invalid={error?.field === "email"}
          className={inputClass(error?.field === "email")}
        />
        {error?.field === "email" && <p className="mt-1 text-xs font-semibold text-red-700" role="alert">{error.message}</p>}

        <label htmlFor={`${id}-password`} className="mt-3 block text-sm font-medium">현재 비밀번호</label>
        <input
          id={`${id}-password`}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          disabled={pending}
          aria-invalid={error?.field === "password"}
          className={inputClass(error?.field === "password")}
        />
        {error?.field === "password" && <p className="mt-1 text-xs font-semibold text-red-700" role="alert">{error.message}</p>}

        <label className="mt-4 flex min-h-11 items-start gap-2 text-sm">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={pending} className="mt-1 size-4 shrink-0 accent-red-700" />
          모든 데이터가 지워지고 되돌릴 수 없다는 것을 이해했어요.
        </label>

        {error?.field === null && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error.message}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" autoFocus onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">취소</button>
          <button type="submit" disabled={!ready || pending} aria-busy={pending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
            {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            {pending ? "삭제 중…" : "계정 삭제"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
