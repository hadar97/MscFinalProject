import AppShell from "@/components/AppShell";
import InsightsTabs from "@/components/insights/InsightsTabs";

export const metadata = { title: "Reading insights - BookBridge" };

export default function InsightsPage() {
  return (
    <AppShell width="max-w-[1100px]">
      <InsightsTabs />
    </AppShell>
  );
}
