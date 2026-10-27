import { Suspense } from "react";
import AuthorRequestsAdmin from "@/components/admin/AuthorRequestsAdmin";

export const metadata = { title: "Author requests - BookBridge admin" };

// /admin/author-requests[?id=7] - the link in the "new author request" email
export default function Page({ searchParams }) {
  return (
    <Suspense fallback={null}>
      <WithParams searchParams={searchParams} />
    </Suspense>
  );
}

async function WithParams({ searchParams }) {
  const { id } = await searchParams;
  return <AuthorRequestsAdmin focusId={Number(id) || null} />;
}
