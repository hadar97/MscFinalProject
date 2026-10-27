import { Suspense } from "react";
import AuthorDetails from "@/components/pages/AuthorDetails";

export const metadata = { title: "Author - BookBridge" };

// /authors/12 - an author account's page (pen name, bio, their books)
export default function AuthorPage({ params }) {
  return (
    <Suspense fallback={null}>
      <AuthorFromParams params={params} />
    </Suspense>
  );
}

async function AuthorFromParams({ params }) {
  const { id } = await params;
  return <AuthorDetails key={id} id={id} />;
}
