"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredUser, getRolePath, getStoredToken, getStoredUser, isTokenExpired, normalizeRole, refreshStoredUser, SessionUser } from "./session";

export function useClienteGuard() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      const currentUser = getStoredUser();
      // Sin usuario, sin token, o token expirado → cerrar sesión y volver al login.
      if (!currentUser || !getStoredToken() || isTokenExpired()) {
        clearStoredUser();
        window.location.replace("/api/auth/logout");
        return;
      }

      const sessionUser = await refreshStoredUser();
      if (!sessionUser) {
        clearStoredUser();
        window.location.replace("/api/auth/logout");
        return;
      }

      const role = normalizeRole(sessionUser.rol);
      if (role !== "cliente") {
        router.replace(getRolePath(role));
        return;
      }

      setUser(sessionUser);
      setCheckingSession(false);
    };

    const handlePageShow = () => {
      void checkSession();
    };

    handlePageShow();
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [router]);

  return { user, checkingSession };
}
