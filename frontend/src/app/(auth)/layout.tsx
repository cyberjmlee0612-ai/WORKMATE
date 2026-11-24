import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="font-geist text-xl font-bold tracking-tight text-primary-dark">WORKMATE</p>
          <p className="mt-0.5 text-xs text-muted">Your AI Work Partner</p>
        </div>
        <main className="surface-card rounded-[20px] p-6 md:p-7">{children}</main>
      </div>
    </div>
  );
}
