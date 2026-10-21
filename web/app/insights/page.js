import AppShell from "@/components/AppShell";
import ComingSoon from "@/components/ComingSoon";

export const metadata = { title: "Reading insights - BookBridge" };

export default function InsightsPage() {
  return (
    <AppShell width="max-w-[900px]">
      <ComingSoon title="Your reading year">
        How your taste changes over time: books finished per month, the genres you read most, and your average rating –
        built from your ratings and the books you mark as finished.
      </ComingSoon>
    </AppShell>
  );
}
