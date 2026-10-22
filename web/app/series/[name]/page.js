import { Suspense } from "react";
import SeriesDetails from "@/components/pages/SeriesDetails";

export const metadata = { title: "Series - BookBridge" };

// /series/Harry%20Potter - the series name comes from the address
export default function SeriesPage({ params }) {
  return (
    <Suspense fallback={null}>
      <SeriesFromParams params={params} />
    </Suspense>
  );
}

async function SeriesFromParams({ params }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  return <SeriesDetails key={decoded} name={decoded} />;
}
