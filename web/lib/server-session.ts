export const SESSION_COOKIE = "turesma_session";

export type SessionClaims = {
  id: number;
  email: string;
  rol: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "http://localhost:4000";
const SESSION_CHECK_TIMEOUT_MS = 10_000;

export const getVerifiedSession = async (token: string): Promise<SessionClaims | null> => {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error(`Session validation failed with status ${response.status}`);

  const data = await response.json();
  const user = data?.user;
  const userId = Number(user?.id);
  if (
    !Number.isInteger(userId) ||
    userId <= 0 ||
    typeof user?.email !== "string" ||
    typeof user?.rol !== "string" ||
    user.activo === false
  ) {
    return null;
  }
  return { id: userId, email: user.email, rol: user.rol };
};

export const getPortalPath = (role: string) => {
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === "conductor" || normalizedRole === "vehiculo") return "/vehiculo";
  if (normalizedRole === "gerente_operativo" || normalizedRole === "admin" || normalizedRole === "operativo") {
    return "/admin";
  }
  if (normalizedRole === "cliente") return "/cliente";
  return null;
};
