export const SESSION_KEY = "turesma_user";
export const TOKEN_KEY = "turesma_token";

export type SessionUser = {
  id?: number;
  nombre?: string;
  email?: string;
  rol?: string;
  imagen_url?: string | null;
};

export const normalizeRole = (role?: string) => {
  const normalized = (role || "usuario").toLowerCase();
  if (normalized === "conductor") return "vehiculo";
  if (normalized === "gerente_operativo") return "operativo";
  return normalized;
};

export const getRolePath = (role?: string) => {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "admin") return "/admin";
  if (normalizedRole === "operativo") return "/admin";
  if (normalizedRole === "cliente") return "/cliente";
  if (normalizedRole === "vehiculo") return "/vehiculo";

  return "/cliente";
};

export const getRoleGreeting = (role?: string) => {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "admin") return "Bienvenido administrador";
  if (normalizedRole === "operativo") return "Bienvenido operativo";
  if (normalizedRole === "cliente") return "Bienvenido cliente";
  if (normalizedRole === "vehiculo") return "Bienvenido conductor";

  return `Bienvenido ${normalizedRole}`;
};

export const getStoredUser = (): SessionUser | null => {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
};

export const setStoredUser = (user: SessionUser) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event("turesma-user-updated"));
};

export const getStoredToken = (): string | null => {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
};

export const setStoredToken = (token: string) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
};

export const refreshStoredUser = async (): Promise<SessionUser | null> => {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const response = await fetch(`${apiUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      // Un límite temporal o un error del servidor no invalida la sesión.
      // Solo un 401 confirma que el token ya no puede utilizarse.
      if (response.status === 401) return null;
      if (response.status === 429 || response.status >= 500) return getStoredUser();
      return null;
    }

    const data = await response.json();
    if (!data?.user || data.user.activo === false) return null;

    setStoredUser(data.user);
    return data.user as SessionUser;
  } catch {
    // Mantener la sesión local durante una falla transitoria de red.
    return getStoredUser();
  }
};

// Decodifica el JWT (sin verificar firma) y comprueba si ya expiró.
// Sirve para echar al usuario al login antes de hacer llamadas que fallarían con 401.
export const isTokenExpired = (): boolean => {
  const token = getStoredToken();
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1] || ""));
    if (!payload || typeof payload.exp !== "number") return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
};

export const getAuthHeaders = (): Record<string, string> => {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
};

export const clearStoredUser = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(TOKEN_KEY);
};

// Si una respuesta de la API es 401 (token ausente o expirado), cierra la sesión
// y vuelve al login. Devuelve true cuando lo manejó: el llamador debe abortar.
export const handleUnauthorized = (status: number): boolean => {
  if (status === 401) {
    clearStoredUser();
    if (typeof window !== "undefined") {
      window.location.href = "/api/auth/logout";
    }
    return true;
  }
  return false;
};
