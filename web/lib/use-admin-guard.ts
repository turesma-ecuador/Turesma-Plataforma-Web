"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredUser, getRolePath, getStoredToken, getStoredUser, isTokenExpired, normalizeRole, refreshStoredUser, SessionUser } from "./session";

export function useAdminGuard() {
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
      if (role !== "admin" && role !== "operativo") {
        router.replace(getRolePath(role));
        return;
      }

      setUser(sessionUser);
      setCheckingSession(false);
    };

    const handleSessionCheck = () => {
      void checkSession();
    };

    const handleCachedUserUpdate = () => {
      const updatedUser = getStoredUser();
      if (updatedUser) {
        setUser(updatedUser);
      }
    };

    handleSessionCheck();
    window.addEventListener("pageshow", handleSessionCheck);
    window.addEventListener("storage", handleSessionCheck);
    window.addEventListener("turesma-user-updated", handleCachedUserUpdate);

    return () => {
      window.removeEventListener("pageshow", handleSessionCheck);
      window.removeEventListener("storage", handleSessionCheck);
      window.removeEventListener("turesma-user-updated", handleCachedUserUpdate);
    };
  }, [router]);

  return { user, checkingSession };
}
