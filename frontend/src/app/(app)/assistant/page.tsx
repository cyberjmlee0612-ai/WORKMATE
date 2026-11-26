import { AssistantView } from "@/components/assistant/AssistantView";

export default function AssistantPage() {
  return (
    <>
      <header className="min-w-0">
        <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">AI Assistant</p>
        <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">AI 업무 도우미</h1>
        <p className="mt-2 text-sm text-muted md:text-base">하고 싶은 일을 적으면 AI가 세부 업무·우선순위·예상 시간을 제안해요. 확인하고 고른 것만 저장돼요.</p>
      </header>
      <AssistantView />
    </>
  );
}
