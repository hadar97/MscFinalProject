import { Suspense } from "react";
import BookDetails from "@/components/pages/BookDetails";

export const metadata = { title: "Book - BookBridge" };

// /books/123 - the id comes from the address; key={id} resets the page for each book
export default function BookPage({ params }) {
  return (
    <Suspense fallback={null}>
      <BookFromParams params={params} />
    </Suspense>
  );
}

async function BookFromParams({ params }) {
  const { id } = await params;
  return <BookDetails key={id} id={id} />;
}
