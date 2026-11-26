import type { Metadata } from "next";
import { CircleAlert, CircleCheck } from "lucide-react";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "로그인 | WORKMATE" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error, deleted } = await searchParams;
  return (
    <>
      {error === "auth_callback" && (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
          <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          인증 링크가 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.
        </p>
      )}
      {deleted === "1" && (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-soft-sage bg-pale-green/60 px-3.5 py-3 text-sm text-primary-dark" role="status">
          <CircleCheck size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          계정과 모든 데이터를 삭제했어요. 그동안 WORKMATE를 이용해 주셔서 감사합니다.
        </p>
      )}
      <AuthForm mode="login" next={typeof next === "string" ? next : undefined} />
    </>
  );
}
