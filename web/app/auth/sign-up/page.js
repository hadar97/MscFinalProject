import AuthForm from "@/app/components/AuthForm";
import { signUpWithEmail } from "./actions";

export const metadata = { title: "Create account - BookBridge" };

export default function SignUpPage() {
  return (
    <AuthForm title="Create your account" subtitle="Two minutes to your first picks. Have an account?" action={signUpWithEmail} withName withConsent
      submitLabel="Create account" altHref="/auth/sign-in" altLabel="Sign in" altText="Next: choose your genres and rate a few books." />
  );
}
