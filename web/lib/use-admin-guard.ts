"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredUser, getRolePath, getStoredToken, getStoredUser, isTokenExpired, normalizeRole, SessionUser } from "./session";

export function useAdminGuard() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const checkSession = () => {
      const currentUser = getStoredUser();
      // Sin usuario, sin token, o token expirado → cerrar sesión y volver al login.
      if (!currentUser || !getStoredToken() || isTokenExpired()) {
        clearStoredUser();
        window.location.replace("/api/auth/logout");
        return;
      }

      const role = normalizeRole(currentUser.rol);
      if (role !== "admin" && role !== "operativo") {
        router.replace(getRolePath(role));
        return;
      }

      setUser(currentUser);
      setCheckingSession(false);
    };

    checkSession();
    window.addEventListener("pageshow", checkSession);
    window.addEventListener("storage", checkSession);
    window.addEventListener("turesma-user-updated", checkSession);

    return () => {
      window.removeEventListener("pageshow", checkSession);
      window.removeEventListener("storage", checkSession);
      window.removeEventListener("turesma-user-updated", checkSession);
    };
  }, [router]);

  return { user, checkingSession };
}
