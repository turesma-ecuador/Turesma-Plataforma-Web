"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, MessageCircle, X } from "lucide-react";
import { getAuthHeaders } from "../lib/session";
import { LocalizedContent } from "../lib/i18n";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const NOTIFICATIONS_POLL_MS = 30000;

type NotificationItem = {
  id: number;
  sender_user_id: number;
  sender_nombre?: string;
  sender_rol?: string;
  mensaje: string;
  creado_en: string;
  leido: boolean;
  link_type?: "cotizacion" | "reserva" | "requerimiento" | "pago" | null;
  link_id?: number | null;
};

type Portal = "admin" | "cliente" | "vehiculo";

type Props = {
  userId?: number;
  accent?: "blue" | "emerald" | "red";
  // Portal actual: decide a qué pantalla navega al hacer clic en una notificación
  // con link_type/link_id.
  portal?: Portal;
};

// Resuelve la ruta según el tipo de recurso enlazado; ?id= identifica el registro.
const resolveLinkPath = (portal: Portal | undefined, linkType?: string | null, linkId?: number | null): string | null => {
  if (!portal || !linkType) return null;
  const withId = (base: string) => (linkId ? `${base}?id=${linkId}` : base);
  if (linkType === "cotizacion") {
    if (portal === "admin") return withId("/admin/cotizaciones");
    if (portal === "cliente") return "/cliente/cotizar";
    return null;
  }
  if (linkType === "reserva") {
    if (portal === "admin") return "/admin/reservas";
    if (portal === "cliente") return "/cliente/historial";
    if (portal === "vehiculo") return "/vehiculo/activas";
  }
  if (linkType === "pago" && portal === "admin") {
    return withId("/admin/pagos");
  }
  if (linkType === "requerimiento" && portal === "admin") {
    return linkId ? `/admin/cotizaciones?requerimiento=${linkId}` : "/admin/cotizaciones";
  }
  return null;
};

const accentStyles = {
  blue: {
    button: "hover:text-blue-600 hover:bg-blue-50",
    badge: "bg-red-500",
    title: "text-blue-600",
    markAll: "text-blue-600 hover:bg-blue-50",
  },
  emerald: {
    button: "hover:text-emerald-600 hover:bg-emerald-50",
    badge: "bg-red-500",
    title: "text-emerald-600",
    markAll: "text-emerald-600 hover:bg-emerald-50",
  },
  red: {
    button: "hover:text-red-600 hover:bg-red-50",
    badge: "bg-red-500",
    title: "text-red-600",
    markAll: "text-red-600 hover:bg-red-50",
  },
};

const getRelativeTime = (dateText: string) => {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return "Ahora";

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Hace instantes";
  if (diffMin < 60) return `Hace ${diffMin} min`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Hace ${diffHours} h`;

  const diffDays = Math.floor(diffHours / 24);
  return `Hace ${diffDays} d`;
};

export function NotificationBell({ userId, accent = "blue", portal }: Props) {
  const styles = useMemo(() => accentStyles[accent] ?? accentStyles.blue, [accent]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  // Aviso emergente lateral (toast) que salta cuando llega una notificación nueva.
  const [toast, setToast] = useState<NotificationItem | null>(null);
  const lastSeenIdRef = useRef<number | null>(null);
  const loadingRef = useRef(false);

  const loadNotifications = async () => {
    if (!userId || !API_URL || loadingRef.current || document.visibilityState === "hidden") return;

    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/comunicacion/notificaciones`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        setUnreadCount(0);
        setItems([]);
        return;
      }

      const text = await res.text();
      const data = text ? JSON.parse(text) : { notifications: [], unread_count: 0 };
      const notifications: NotificationItem[] = Array.isArray(data.notifications) ? data.notifications : [];
      setUnreadCount(Number(data.unread_count || 0));
      setItems(notifications);

      const maxId = notifications.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0);
      if (lastSeenIdRef.current === null) {
        lastSeenIdRef.current = maxId;
      } else if (maxId > lastSeenIdRef.current) {
        const nuevas = notifications
          .filter((n) => Number(n.id) > (lastSeenIdRef.current as number) && !n.leido)
          .sort((a, b) => Number(b.id) - Number(a.id));
        if (nuevas.length > 0) setToast(nuevas[0]);
        lastSeenIdRef.current = maxId;
      }
    } catch (error) {
      console.warn("No se pudieron cargar las notificaciones:", error);
      setUnreadCount(0);
      setItems([]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const markAllAsRead = async () => {
    if (!userId || unreadCount <= 0) return;

    try {
      const res = await fetch(`${API_URL}/api/comunicacion/notificaciones/leidas`, {
        method: "PATCH",
        headers: getAuthHeaders(),
      });

      if (!res.ok) return;

      setUnreadCount(0);
      setItems((prev) => prev.map((item) => ({ ...item, leido: true })));
    } catch {
      // Silencioso para no romper UX
    }
  };

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const startPolling = () => {
      if (document.visibilityState !== "visible" || interval) return;
      loadNotifications();
      interval = setInterval(loadNotifications, NOTIFICATIONS_POLL_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") startPolling();
      else stopPolling();
    };

    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // El toast lateral se cierra solo a los 7 segundos.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleItemClick = async (item: NotificationItem) => {
    // Marca solo esta notificación como leída (no todas)
    if (!item.leido && userId) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, leido: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
      fetch(`${API_URL}/api/comunicacion/notificaciones/${item.id}/leida`, {
        method: "PATCH",
        headers: getAuthHeaders(),
      }).catch(() => { /* silencio */ });
    }

    const path = resolveLinkPath(portal, item.link_type, item.link_id);
    if (path) {
      setOpen(false);
      router.push(path);
    }
  };

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      const left = Math.min(Math.max(rect.right - width, 12), window.innerWidth - width - 12);
      const top = Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 200));
      setPopoverPosition({
        top,
        left,
        width,
        maxHeight: Math.max(160, window.innerHeight - top - 16),
      });
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    updatePosition();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <LocalizedContent enabled={portal === "cliente"}>
    <div className="relative" ref={wrapperRef}>
      <button
        ref={buttonRef}
        onClick={() => {
          if (!open) setPopoverPosition(null);
          setOpen((prev) => !prev);
        }}
        className={`p-2.5 text-slate-500 rounded-xl transition-all relative ${styles.button}`}
        type="button"
        aria-label="Abrir notificaciones"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center ${styles.badge}`}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && popoverPosition && typeof document !== "undefined" && createPortal(
        <LocalizedContent enabled={portal === "cliente"}>
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Notificaciones"
          style={{
            position: "fixed",
            top: popoverPosition.top,
            left: popoverPosition.left,
            width: popoverPosition.width,
            maxHeight: popoverPosition.maxHeight,
          }}
          className="z-[100] overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-2xl animate-in zoom-in-95 duration-200 origin-top-right"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className={`text-sm font-bold ${styles.title}`}>Notificaciones</h3>
            <button
              type="button"
              onClick={markAllAsRead}
              className={`text-xs font-semibold rounded-lg px-2 py-1 transition-colors disabled:opacity-50 ${styles.markAll}`}
              disabled={unreadCount <= 0}
            >
              <span className="inline-flex items-center gap-1">
                <CheckCheck size={14} />
                Marcar leidas
              </span>
            </button>
          </div>

          <div className="overflow-y-auto space-y-2 pr-1" style={{ maxHeight: Math.max(80, popoverPosition.maxHeight - 72) }}>
            {loading && items.length === 0 ? (
              <p className="text-xs text-slate-500">Cargando notificaciones...</p>
            ) : items.length === 0 ? (
              <p className="text-xs text-slate-500">No tienes notificaciones.</p>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className={`w-full text-left rounded-xl border px-3 py-2 transition-colors cursor-pointer hover:bg-blue-50 ${
                    item.leido ? "bg-white border-slate-200" : "bg-slate-50 border-slate-300"
                  }`}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <p data-no-translate className="text-xs font-semibold text-slate-900 leading-tight">
                      {item.sender_nombre || "Usuario"}
                      {item.sender_rol ? ` (${item.sender_rol})` : ""}
                    </p>
                    {!item.leido && <span className="mt-0.5 inline-block w-2 h-2 rounded-full bg-red-500" />}
                  </div>
                  <p data-no-translate className="text-xs text-slate-700 line-clamp-2">{item.mensaje}</p>
                  <p className="mt-1 text-[10px] text-slate-500 inline-flex items-center gap-1">
                    <MessageCircle size={12} />
                    {getRelativeTime(item.creado_en)}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
        </LocalizedContent>,
        document.body,
      )}

      {/* TOAST LATERAL: salta al llegar una notificación nueva, mostrando qué es */}
      {toast && (
        <div className="fixed top-20 right-4 left-4 sm:left-auto sm:w-96 z-[200] animate-in slide-in-from-top-4 fade-in duration-300">
          <div
            role="button"
            tabIndex={0}
            onClick={() => { handleItemClick(toast); setToast(null); }}
            className="w-full text-left bg-white rounded-2xl shadow-2xl border border-slate-100 border-l-4 border-l-[#E31E24] p-4 flex items-start gap-3 cursor-pointer hover:bg-slate-50 transition-colors"
          >
            <div className="bg-[#E31E24]/10 p-2 rounded-xl shrink-0">
              <Bell size={18} className="text-[#E31E24]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-widest text-[#E31E24]">Nueva notificación</p>
              <p data-no-translate className="text-sm text-slate-800 leading-snug mt-0.5 line-clamp-3">{toast.mensaje}</p>
              <p className="text-[10px] text-slate-400 mt-1">{getRelativeTime(toast.creado_en)}</p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setToast(null); }}
              className="p-1 text-slate-400 hover:text-slate-700 shrink-0"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
    </LocalizedContent>
  );
}
