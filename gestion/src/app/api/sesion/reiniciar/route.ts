import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { SESSION_COOKIE } from "@/lib/auth/session";

/** Clears a session cookie that no longer maps to a live user, then shows the login. */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
