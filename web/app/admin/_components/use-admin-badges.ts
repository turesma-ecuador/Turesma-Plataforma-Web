"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { useEffect, useState } from "react";
import { getAuthHeaders } from "../../../lib/session";

const API_URL = API_BASE_URL;

// Contadores de pendientes por sección, para mostrar un badge junto al item
// del sidebar que corresponda (ej. cuántas cotizaciones esperan respuesta,
// cuántos pagos faltan por revisar).
export const useAdminBadges = (enabled: boolean) => {
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let loading = false;

    const load = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const res = await fetch(`${API_URL}/api/admin/badges-sidebar`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setBadges(data || {});
      } catch {
        // silencio
      } finally {
        loading = false;
      }
    };

    load();
    const interval = setInterval(load, 15000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled]);

  return badges;
};
