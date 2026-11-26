import { SettingsView } from "@/components/settings/SettingsView";

export default function SettingsPage() {
  return (
    <>
      <header className="min-w-0">
        <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">Settings</p>
        <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">설정</h1>
        <p className="mt-2 text-sm text-muted md:text-base">프로필과 일하는 시간, 계정을 관리해요.</p>
      </header>
      <SettingsView />
    </>
  );
}
