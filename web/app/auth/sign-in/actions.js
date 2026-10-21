"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";

export async function signInWithEmail(_prevState, formData) {
  const { error } = await auth.signIn.email({
    email: String(formData.get("email") || ""),
    password: String(formData.get("password") || ""),
  });
  if (error) return { error: error.message || "Sign-in failed" };
  redirect("/for-you");
}
