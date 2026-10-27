import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { SITE } from "@/lib/site";

export const metadata = { title: "Privacy Policy - BookBridge" };

// Keep in sync with what the code really does (server/, web/). If you change it
// in a way users should know about, update SITE.policyDate (web/lib/site.js)
// and the privacy version in server/consents.js - users will be asked again.
export default function PrivacyPage() {
  const mail = <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>;
  return (
    <LegalPage title="Privacy Policy">
      <p className="note mt-6">
        {SITE.name} is a student graduation project at {SITE.institution}, built for academic purposes. It is not a
        commercial service. This policy explains what we collect, why, and the choices you have.
      </p>

      <h2>1. Who is responsible</h2>
      <p>The {SITE.name} project team (students at {SITE.institution}). Contact: {mail}.</p>

      <h2>2. What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address and password. Passwords are stored only in hashed form by our login provider; we never see them.</li>
        <li><strong>Your reading profile:</strong> the genres you choose, the books you rate, books you add to your TBR (“to be read”) list, mark as finished or hide (“Not for me”), and your preferred city.</li>
        <li><strong>What you post:</strong> reviews you write and your posts and replies in book discussions.</li>
        <li><strong>Author requests</strong> (only if you send one): your pen name, the books you list and your message, so we can check that you are the author.</li>
        <li><strong>Your consent choices:</strong> which version of these documents you agreed to and when, and whether you allowed research use.</li>
        <li><strong>Location – only when you ask for it:</strong> if you choose “Near my location”, your browser sends your approximate coordinates to find libraries within 10 km. They are used for that request only and are <strong>not stored</strong>.</li>
        <li><strong>Questions to the assistant</strong> (“Ask {SITE.name}”, when available): the messages you write, so the assistant can answer them.</li>
      </ul>
      <p>We do not collect payment details, and we do not use advertising or analytics trackers.</p>

      <h2>3. Why we use it</h2>
      <ul>
        <li>To run your account and keep you signed in.</li>
        <li>To recommend books to you – your ratings and genres are what the recommendations are based on.</li>
        <li>To show where a book can be borrowed (the library inventory shown is a <strong>simulated demo</strong>).</li>
        <li>For academic research about recommender systems – <strong>only if you agreed</strong>, and only in anonymized, aggregated form (no names or email addresses). You can withdraw this at any time in your Account page; the app works the same either way.</li>
      </ul>
      <p>We use your data because you agreed to it when you signed up, and because it is needed to provide the service you asked for.</p>

      <h2>4. What other users see</h2>
      <p>
        Reviews, posts and replies you write are visible to other signed-in users, with your first name and the first
        letter of your last name (for example “Dana L.”) – never your email address. Your ratings, TBR list and Insights
        stay private; only the stars that go with a review you post are shown with it. You can edit or delete your
        reviews and delete your posts at any time.
      </p>

      <h2>5. Who else processes it</h2>
      <p>We do not sell or rent your data. We use a few service providers that process it on our behalf:</p>
      <ul>
        <li><strong>Neon</strong> – database and login (account and profile data).</li>
        <li><strong>Anthropic</strong> – the AI model behind the assistant, which receives the questions you write to it.</li>
        <li>The hosting provider that runs the website.</li>
      </ul>
      <p>These providers may store data on servers outside Israel (for example in the United States or Europe).</p>

      <h2>6. Cookies and browser storage</h2>
      <p>
        We use only what the site needs to work: a login cookie that keeps you signed in, and temporary browser storage
        for things like the genres you picked during sign-up. No advertising or tracking cookies.
      </p>

      <h2>7. How long we keep it</h2>
      <p>
        As long as your account exists. If you ask us to delete your account, your profile, ratings, lists and consent
        records, reviews and posts are deleted with it. When the academic project ends, the service may be shut down and its user data deleted.
      </p>

      <h2>8. Security</h2>
      <p>
        Access to your data requires your login; each user can reach only their own data. Passwords are hashed, and data is
        sent over encrypted connections. No system is perfectly secure, so please use a password you do not use elsewhere.
      </p>

      <h2>9. Your rights</h2>
      <p>You can ask to see the data we hold about you, to correct it, or to delete your account and its data. You can withdraw research consent in your Account page at any time. Write to {mail}. Depending on where you live (for example under Israel’s Privacy Protection Law), you may have additional rights.</p>

      <h2>10. Age</h2>
      <p>{SITE.name} is for people aged {SITE.minAge} and over. We do not knowingly collect data from younger users; if you believe a younger person has signed up, please contact us and we will delete the account.</p>

      <h2>11. Changes</h2>
      <p>If we change this policy in a way that matters, the date above will change and you will be asked to agree again before continuing to use the app.</p>

      <p className="mt-10 text-sm text-muted">See also the <Link href="/terms">Terms of Use</Link>.</p>
    </LegalPage>
  );
}
