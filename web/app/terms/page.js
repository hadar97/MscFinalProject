import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { SITE } from "@/lib/site";

export const metadata = { title: "Terms of Use - BookBridge" };

// If these terms change in a way users should know about, update SITE.policyDate
// (web/lib/site.js) and the terms version in server/consents.js.
export default function TermsPage() {
  const mail = <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>;
  return (
    <LegalPage title="Terms of Use">
      <p className="note mt-6">
        {SITE.name} is a student graduation project at {SITE.institution}. It is offered free of charge, for academic
        and demonstration purposes, “as is”. By creating an account you agree to these terms and to the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>1. Who can use {SITE.name}</h2>
      <p>You must be at least {SITE.minAge} years old. You are responsible for your account and for keeping your password private.</p>

      <h2>2. Recommendations</h2>
      <p>
        Book recommendations are produced automatically by algorithms, based on your ratings, your genres and the reading
        habits of other readers. They may not always suit you, and they are not professional advice of any kind.
      </p>

      <h2>3. Library availability is a demo</h2>
      <p>
        The library branches shown are real, but the inventory (which books are on which shelf) is <strong>simulated</strong>{" "}
        for demonstration. Always check with the library before you go.
      </p>

      <h2>4. The assistant (“Ask {SITE.name}”)</h2>
      <p>
        When available, the assistant uses an AI model. Its answers can be wrong or incomplete – please check anything
        important. Do not write sensitive personal information in your questions.
      </p>

      <h2>5. What you post</h2>
      <p>
        You are responsible for the reviews, posts and replies you write. They are shown to other users with your first
        name and last initial. Please be respectful, keep them about books, and warn before spoilers. Do not post
        personal information about others, hateful or harassing content, spam or anything unlawful. We may remove
        content or suspend accounts that break these rules. Accounts marked “Author” are linked to their books by the
        project team after a check.
      </p>

      <h2>6. Book information</h2>
      <p>
        Book details and cover images come from public sources (the goodbooks-10k dataset, based on Goodreads, and Google
        Books). Titles, covers and trademarks belong to their respective owners and are shown for identification only.
      </p>

      <h2>7. Acceptable use</h2>
      <ul>
        <li>Do not try to access other users’ accounts or data, or to disrupt or overload the service.</li>
        <li>Do not copy the catalog or recommendations in bulk by automated means.</li>
        <li>Do not use the service, including the assistant, for anything unlawful or abusive.</li>
      </ul>
      <p>We may suspend accounts that break these rules.</p>

      <h2>8. Availability</h2>
      <p>
        As an academic project, the service may change, be unavailable at times, or be shut down when the project ends,
        without prior notice.
      </p>

      <h2>9. Ending your account</h2>
      <p>You can stop using {SITE.name} at any time. To delete your account and its data, write to {mail}.</p>

      <h2>10. Liability</h2>
      <p>
        To the extent permitted by law, the project team is not liable for any loss or damage arising from the use of the
        service, including reliance on recommendations or on library availability.
      </p>

      <h2>11. Law</h2>
      <p>These terms are governed by the laws of the State of Israel.</p>

      <h2>12. Changes</h2>
      <p>If these terms change in a way that matters, the date above will change and you will be asked to agree again.</p>

      <h2>13. Contact</h2>
      <p>Questions about these terms: {mail}.</p>
    </LegalPage>
  );
}
