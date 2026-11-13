import { NextResponse } from "next/server";
import { getBackendApiUrl } from "../../../../lib/backend-url";
import { getVerifiedSession, SESSION_COOKIE } from "../../../../lib/server-session";

const API_URL = getBackendApiUrl();
const LOGIN_TIMEOUT_MS = 10_000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Solicitud de inicio de sesión inválida" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "El servicio de autenticación tardó demasiado. Inténtalo de nuevo." }, { status: 504 });
    }
    return NextResponse.json({ error: "No se pudo conectar con el servicio de autenticación" }, { status: 502 });
  }

  let data: Record<string, unknown>;
  try {
    data = await upstream.json();
  } catch {
    return NextResponse.json({ error: "El servicio de autenticación devolvió una respuesta inválida" }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const token = typeof data.token === "string" ? data.token : "";
  let session;
  try {
    session = token ? await getVerifiedSession(token) : null;
  } catch (error) {
    console.error("No se pudo verificar el token con el backend:", error);
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timedOut
          ? "La confirmación de la sesión tardó demasiado. Inténtalo de nuevo."
          : "El servicio de autenticación no está disponible para confirmar la sesión.",
      },
      { status: timedOut ? 504 : 502 },
    );
  }
  if (!session) {
    return NextResponse.json(
      { error: "El backend rechazó el token de inicio de sesión." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ...data, user: session }, {
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  return response;
}
