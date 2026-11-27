"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { useEffect, useState } from "react";
import { getAuthHeaders } from "../../../lib/session";

const API_URL = API_BASE_URL;

type CotizacionBadge = {
  turno?: string;
  estado?: string;
};

type ReservaBadge = {
  estado?: string;
};

// Contadores de pendientes para el cliente: cuántas cotizaciones esperan su
// respuesta (el admin contraofertó) y cuántas reservas le faltan pagar,
// para mostrarlos como badge junto a "Cotizar" y "Historial" del sidebar.
export const useClienteBadges = (enabled: boolean) => {
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let loading = false;

    const load = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const [cotRes, resRes] = await Promise.all([
          fetch(`${API_URL}/api/cotizaciones/mias`, { headers: getAuthHeaders() }),
          fetch(`${API_URL}/api/usuarios/mis-reservas`, { headers: getAuthHeaders() }),
        ]);

        const cotizaciones: unknown = cotRes.ok ? await cotRes.json() : [];
        const reservas: unknown = resRes.ok ? await resRes.json() : [];

        const cotizarPendientes = Array.isArray(cotizaciones)
          ? (cotizaciones as CotizacionBadge[]).filter((c) => c.turno === "cliente" && !["aprobada", "rechazada"].includes(c.estado ?? "")).length
          : 0;
        const historialPendientes = Array.isArray(reservas)
          ? (reservas as ReservaBadge[]).filter((r) => r.estado === "pendiente_pago").length
          : 0;

        if (!cancelled) {
          setBadges({
            "/cliente/cotizar": cotizarPendientes,
            "/cliente/historial": historialPendientes,
          });
        }
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
