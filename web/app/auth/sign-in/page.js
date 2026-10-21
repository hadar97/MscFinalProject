import AuthForm from "@/app/components/AuthForm";
import { signInWithEmail } from "./actions";

export const metadata = { title: "Sign in - BookBridge" };

export default function SignInPage() {
  return (
    <AuthForm title="Welcome back" subtitle="Sign in to see your picks. New here?" action={signInWithEmail}
      submitLabel="Sign in" altHref="/auth/sign-up" altLabel="Create an account" altText="Your ratings stay private to you." />
  );
}
