import { NextRequest, NextResponse } from "next/server";
import { getPortalPath, getVerifiedSession, SESSION_COOKIE } from "./lib/server-session";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let session;
  try {
    session = token ? await getVerifiedSession(token) : null;
  } catch (error) {
    console.error("No se pudo verificar la sesión con el backend:", error);
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("auth_error", "unavailable");
    return NextResponse.redirect(loginUrl);
  }
  const requestedPortal = `/${request.nextUrl.pathname.split("/")[1]}`;

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("auth_error", "expired");
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  const userPortal = getPortalPath(session.rol);
  if (!userPortal) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("auth_error", "role");
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  const allowed = userPortal === requestedPortal;

  if (
    allowed &&
    request.nextUrl.pathname.startsWith("/admin/calendario-flota") &&
    session.rol.toLowerCase() !== "admin"
  ) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  if (!allowed) {
    return NextResponse.redirect(new URL(userPortal || "/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/cliente/:path*", "/vehiculo/:path*"],
};
