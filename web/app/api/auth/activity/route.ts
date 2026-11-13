import { NextRequest, NextResponse } from "next/server";
import { getBackendApiUrl } from "../../../../lib/backend-url";
import { SESSION_COOKIE } from "../../../../lib/server-session";

const API_URL = getBackendApiUrl();
const ACTIVITY_TIMEOUT_MS = 8_000;

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { error: "La sesión ya no está disponible." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const upstream = await fetch(`${API_URL}/api/auth/activity`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(ACTIVITY_TIMEOUT_MS),
    });

    if (upstream.ok) {
      return new NextResponse(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const data = await upstream.json().catch(() => ({})) as { error?: string };
    const response = NextResponse.json(
      { error: data.error || "No se pudo mantener la sesión activa." },
      { status: upstream.status, headers: { "Cache-Control": "no-store" } },
    );
    if (upstream.status === 401) response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch (error) {
    console.error("No se pudo registrar la actividad de sesión:", error);
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      { error: timedOut ? "La actualización de sesión tardó demasiado." : "El servicio de autenticación no está disponible." },
      {
        status: timedOut ? 504 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
