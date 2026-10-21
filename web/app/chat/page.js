import AppShell from "@/components/AppShell";
import ComingSoon from "@/components/ComingSoon";

export const metadata = { title: "Ask BookBridge - BookBridge" };

// Model 2 (the LLM + RAG chatbot) plugs in here
export default function ChatPage() {
  return (
    <AppShell width="max-w-[900px]">
      <ComingSoon title="Ask BookBridge" owner="AI model 2">
        Describe the book you are in the mood for – “something like Dune, but shorter” – and refine it in conversation.
        Every answer comes from real books in the BookBridge catalog.
      </ComingSoon>
    </AppShell>
  );
}
