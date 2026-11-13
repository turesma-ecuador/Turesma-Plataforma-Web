import { NextRequest, NextResponse } from "next/server";
import { getBackendApiUrl } from "../../../../lib/backend-url";
import { SESSION_COOKIE } from "../../../../lib/server-session";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const upstream = await fetch(`${getBackendApiUrl()}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!upstream.ok && upstream.status !== 401) {
        console.error(`El backend no pudo revocar la sesión (HTTP ${upstream.status}).`);
      }
    } catch (error) {
      console.error("No se pudo revocar la sesión en el backend:", error);
    }
  }

  const loginUrl = new URL("/login", request.url);
  const reason = request.nextUrl.searchParams.get("reason");
  if (reason === "inactivity") loginUrl.searchParams.set("session", "inactive");
  else if (reason === "expired") loginUrl.searchParams.set("session", "expired");

  const response = NextResponse.redirect(loginUrl);
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
