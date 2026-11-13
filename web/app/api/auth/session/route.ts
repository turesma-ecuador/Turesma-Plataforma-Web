import { NextRequest, NextResponse } from "next/server";
import { getVerifiedSession, SESSION_COOKIE } from "../../../../lib/server-session";

const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
};

export async function GET(request: NextRequest) {
  const bearerToken = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearerToken || request.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return clearSessionCookie(NextResponse.json(
      { error: "No hay una sesión guardada para verificar." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    ));
  }

  try {
    const user = await getVerifiedSession(token);
    if (!user) {
      return clearSessionCookie(NextResponse.json(
        { error: "La sesión guardada ya no es válida." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      ));
    }

    const response = NextResponse.json(
      { user },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("No se pudo verificar la sesión guardada:", error);
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timedOut
          ? "La verificación de sesión tardó demasiado. Inténtalo de nuevo."
          : "El servicio de autenticación no está disponible. Inténtalo de nuevo.",
      },
      {
        status: timedOut ? 504 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
