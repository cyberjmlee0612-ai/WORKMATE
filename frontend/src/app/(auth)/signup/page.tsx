import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "회원가입 | WORKMATE" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  return <AuthForm mode="signup" next={typeof next === "string" ? next : undefined} />;
}
