"use client";

import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import {
  clearStoredUser,
  getAuthHeaders,
  getRoleGreeting,
  getRolePath,
  getStoredToken,
  getStoredUser,
  handleUnauthorized,
  isTokenExpired,
  normalizeRole,
  refreshStoredUser,
  SessionUser,
} from "../../../lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const POLLING_INTERVAL = 8000;

export type ReservaConductor = {
  id: number;
  operation_id?: number;
  requerimiento_id?: number;
  grupo_numero?: number | null;
  unidad_numero?: number | null;
  fecha_reserva: string;
  fecha_fin?: string | null;
  fecha_regreso?: string | null;
  hora_regreso?: string | null;
  ida_finalizada?: boolean;
  fecha_salida?: string | null;
  fecha_llegada?: string | null;
  eta_actualizada?: string | null;
  incidencia_detalle?: string | null;
  origen?: string | null;
  destino?: string | null;
  estado: string;
  num_personas: number;
  total: number;
  usuario_nombre?: string;
  usuario_email?: string;
  usuario_telefono?: string | null;
  usuario_verificacion?: string;
  tour_titulo?: string;
  tour_ubicacion?: string;
  vehiculo_placa?: string | null;
  origen_lat?: number | null;
  origen_lng?: number | null;
  destino_lat?: number | null;
  destino_lng?: number | null;
  recogida_lat?: number | null;
  recogida_lng?: number | null;
  referencia_recogida?: string | null;
  hora_salida?: string | null;
  recogido?: boolean;
  itinerario?: Array<{
    label?: string;
    destino?: string;
    fecha_llegada?: string | null;
    hora_salida?: string | null;
    dias_estadia?: number;
    es_retorno?: boolean;
  }>;
  itinerario_progreso?: number;
  asignacion_confirmada_en?: string | null;
};

export type VehiculoAsignado = {
  id?: number;
  placa: string;
  modelo: string;
  tipo: string;
  estado: string;
  capacidad?: number;
  color?: string | null;
  imagen_url?: string | null;
  descripcion?: string | null;
  marca?: string | null;
  anio?: number | null;
  kilometraje?: number | null;
};

type PanelConductor = {
  activas: ReservaConductor[];
  historial: ReservaConductor[];
};

const useConductorPanelState = () => {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [panel, setPanel] = useState<PanelConductor>({ activas: [], historial: [] });
  const [vehiculo, setVehiculo] = useState<VehiculoAsignado | null>(null);
  const [loadingPanel, setLoadingPanel] = useState(false);
  const [err, setErr] = useState("");
  const primeraCargaRef = useRef(true);

  useEffect(() => {
    const checkSession = async () => {
      const currentUser = getStoredUser();
      // Sin usuario, sin token, o token expirado → cerrar sesión y volver al login.
      if (!currentUser || !getStoredToken() || isTokenExpired()) {
        clearStoredUser();
        window.location.replace("/api/auth/logout");
        return;
      }

      // Reconcile cached profile data with the identity encoded in the validated
      // token before building self-scoped API URLs.
      const sessionUser = await refreshStoredUser();
      if (!sessionUser) {
        clearStoredUser();
        window.location.replace("/api/auth/logout");
        return;
      }

      const role = normalizeRole(sessionUser.rol);
      if (role !== "conductor" && role !== "vehiculo") {
        router.replace(getRolePath(role));
        return;
      }

      if (!sessionUser.id) {
        clearStoredUser();
        window.location.replace("/api/auth/logout");
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
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [router]);

  const loadPanel = async (silencioso = false) => {
    if (!user?.id) return;
    if (!silencioso) setLoadingPanel(true);
    setErr("");

    try {
      const res = await fetch(`${API_URL}/api/conductor/me/reservas`, {
        headers: getAuthHeaders(),
      });
      if (handleUnauthorized(res.status)) return;
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "No se pudo cargar el panel del conductor");
      }

      const activas: ReservaConductor[] = Array.isArray(data.activas) ? data.activas : [];
      const historial: ReservaConductor[] = Array.isArray(data.historial) ? data.historial : [];

      setPanel({ activas, historial });

      setVehiculo(data.vehiculo ?? null);
    } catch (loadError) {
      setErr(loadError instanceof Error ? loadError.message : "No se pudo cargar el panel");
    } finally {
      setLoadingPanel(false);
    }
  };

  // La primera carga muestra el spinner; los sondeos siguientes actualizan
  // los datos en silencio para que la pantalla no parpadee.
  useAutoRefresh(() => {
    const silencioso = !primeraCargaRef.current;
    primeraCargaRef.current = false;
    loadPanel(silencioso);
  }, {
    enabled: !checkingSession && !!user?.id,
    intervalMs: POLLING_INTERVAL,
  });

  const formatFecha = (value?: string) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
  };

  const greeting = useMemo(() => getRoleGreeting(user?.rol), [user?.rol]);

  return {
    user,
    checkingSession,
    panel,
    vehiculo,
    loadingPanel,
    err,
    greeting,
    loadPanel,
    formatFecha,
  };
};

type ConductorPanelState = ReturnType<typeof useConductorPanelState>;

const ConductorPanelContext = createContext<ConductorPanelState | null>(null);

export function ConductorPanelProvider({
  value,
  children,
}: {
  value: ConductorPanelState;
  children: React.ReactNode;
}) {
  return createElement(ConductorPanelContext.Provider, { value }, children);
}

export function useConductorPanel() {
  const context = useContext(ConductorPanelContext);
  if (!context) {
    throw new Error("useConductorPanel debe usarse dentro de ConductorPanelProvider");
  }
  return context;
}

export { useConductorPanelState };
