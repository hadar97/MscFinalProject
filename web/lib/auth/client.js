"use client";

// Neon Auth in the browser (client components): session, sign out, login token.
import { createAuthClient } from "@neondatabase/auth/next";

export const authClient = createAuthClient();
