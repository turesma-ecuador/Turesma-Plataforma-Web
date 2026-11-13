"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { clearStoredUser, getStoredToken, LAST_ACTIVITY_KEY, TOKEN_KEY } from "../lib/session";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 10 * 1000;
const LOCAL_ACTIVITY_INTERVAL_MS = 1000;
const POINTER_MOVE_INTERVAL_MS = 5000;

export function SessionActivityMonitor() {
  const pathname = usePathname();
  const [error, setError] = useState("");

  useEffect(() => {
    if (pathname === "/login" || !getStoredToken()) return;

    let disposed = false;
    let heartbeatInFlight = false;
    let lastHeartbeatAttemptAt = 0;
    let lastActivityPersistedAt = 0;
    let lastPointerMoveAt = 0;
    let lastActivityAt = Date.now();
    let storageErrorMessage = "";
    let expiryTimer: ReturnType<typeof setTimeout>;

    const readSharedActivity = () => {
      try {
        const sharedActivityAt = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
        return Number.isFinite(sharedActivityAt) && sharedActivityAt > 0
          ? sharedActivityAt
          : null;
      } catch (storageError) {
        console.error("No se pudo sincronizar la actividad entre pestañas:", storageError);
        storageErrorMessage = "No se pudo sincronizar la actividad entre pestañas.";
        return null;
      }
    };

    try {
      const savedActivityAt = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
      if (Number.isFinite(savedActivityAt) && savedActivityAt > 0) {
        lastActivityAt = savedActivityAt;
      } else {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityAt));
      }
    } catch (storageError) {
      console.error("No se pudo leer la actividad local de sesión:", storageError);
      storageErrorMessage = "No se pudo sincronizar el cierre por inactividad en este navegador.";
    }

    const expireSession = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(expiryTimer);
      try {
        clearStoredUser();
      } catch (storageError) {
        console.error("No se pudo limpiar la sesión local:", storageError);
      } finally {
        window.location.replace("/api/auth/logout?reason=inactivity");
      }
    };

    const scheduleExpiry = () => {
      clearTimeout(expiryTimer);
      const sharedActivityAt = readSharedActivity();
      if (sharedActivityAt && sharedActivityAt > lastActivityAt) {
        lastActivityAt = sharedActivityAt;
      }
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt);
      if (remaining <= 0) {
        expireSession();
        return;
      }
      expiryTimer = setTimeout(() => {
        const sharedActivityAt = readSharedActivity();
        if (sharedActivityAt && sharedActivityAt > lastActivityAt) {
          lastActivityAt = sharedActivityAt;
        }
        scheduleExpiry();
      }, remaining);
    };

    const sendActivityHeartbeat = async () => {
      if (disposed) return;
      const now = Date.now();
      if (heartbeatInFlight || now - lastHeartbeatAttemptAt < HEARTBEAT_INTERVAL_MS) return;
      lastHeartbeatAttemptAt = now;
      heartbeatInFlight = true;

      try {
        const response = await fetch("/api/auth/activity", {
          method: "POST",
          cache: "no-store",
          keepalive: true,
        });
        if (disposed) return;
        if (response.status === 401) {
          try {
            clearStoredUser();
          } catch (storageError) {
            console.error("No se pudo limpiar la sesión local:", storageError);
          } finally {
            window.location.replace("/api/auth/logout?reason=expired");
          }
          return;
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          setError(payload.error || "No se pudo renovar tu sesión. Se cerrará al cumplir 15 minutos de inactividad.");
          return;
        }
        setError(storageErrorMessage);
      } catch (heartbeatError) {
        if (!disposed) {
          console.error("No se pudo registrar la actividad de sesión:", heartbeatError);
          setError("No se pudo verificar tu sesión con el servidor. Intenta mantener la conexión activa.");
        }
      } finally {
        heartbeatInFlight = false;
      }
    };

    const recordActivity = (event: Event) => {
      if (!event.isTrusted || disposed) return;
      const now = Date.now();
      lastActivityAt = now;
      if (now - lastActivityPersistedAt >= LOCAL_ACTIVITY_INTERVAL_MS) {
        try {
          localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
          lastActivityPersistedAt = now;
        } catch (storageError) {
          console.error("No se pudo sincronizar la actividad entre pestañas:", storageError);
          storageErrorMessage = "No se pudo sincronizar la actividad entre pestañas.";
          setError(storageErrorMessage);
        }
      }
      scheduleExpiry();
      void sendActivityHeartbeat();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const now = Date.now();
      if (now - lastPointerMoveAt < POINTER_MOVE_INTERVAL_MS) return;
      lastPointerMoveAt = now;
      recordActivity(event);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LAST_ACTIVITY_KEY && event.newValue) {
        const sharedActivityAt = Number(event.newValue);
        if (Number.isFinite(sharedActivityAt) && sharedActivityAt > lastActivityAt) {
          lastActivityAt = sharedActivityAt;
          scheduleExpiry();
        }
        return;
      }

      if (event.key === TOKEN_KEY && !event.newValue) {
        disposed = true;
        clearTimeout(expiryTimer);
        window.location.replace("/api/auth/logout");
      }
    };

    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("touchstart", recordActivity, { passive: true });
    window.addEventListener("scroll", recordActivity, { passive: true });
    window.addEventListener("storage", handleStorage);
    scheduleExpiry();

    return () => {
      disposed = true;
      clearTimeout(expiryTimer);
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("touchstart", recordActivity);
      window.removeEventListener("scroll", recordActivity);
      window.removeEventListener("storage", handleStorage);
    };
  }, [pathname]);

  if (!error) return null;

  return (
    <div role="alert" className="fixed inset-x-4 top-4 z-[100] mx-auto max-w-xl rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900 shadow-lg">
      {error}
    </div>
  );
}
