// All Neon Auth requests from the browser go through this route (/api/auth/...).
import { auth } from "@/lib/auth/server";

export const { GET, POST } = auth.handler();
