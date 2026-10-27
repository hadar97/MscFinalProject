"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { safeNext } from "@/lib/next-path";

export async function signInWithEmail(_prevState, formData) {
  const { error } = await auth.signIn.email({
    email: String(formData.get("email") || ""),
    password: String(formData.get("password") || ""),
  });
  if (error) return { error: error.message || "Sign-in failed" };
  redirect(safeNext(String(formData.get("next") || "")));   // back to the page they asked for
}
