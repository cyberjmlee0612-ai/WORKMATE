"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    if (pending) return;
    setPending(true);
    const { error } = await createClient().auth.signOut();
    if (error) {
      setPending(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      aria-busy={pending}
      className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-primary-dark hover:bg-pale-green disabled:opacity-60"
      aria-label="로그아웃"
      title="로그아웃"
    >
      <LogOut size={20} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
