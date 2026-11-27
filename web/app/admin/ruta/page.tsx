"use client";

import { API_BASE_URL } from "@/lib/api-url";
import { useEffect, useRef, useState } from "react";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders, handleUnauthorized } from "../../../lib/session";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { MapPin, Bus, Loader2, Navigation, Clock, ArrowRight } from "lucide-react";
import { calcularRuta, formatDuracion } from "../../../lib/leaflet";

const API = API_BASE_URL;
const POLL_MS = 2000;

type Coord = { lat: number; lng: number };
type Ubicacion = {
  vehiculo_id: number;
  lat: number;
  lng: number;
  creado_en: string;
  placa: string;
  modelo?: string | null;
  tipo?: string | null;
  conductor_nombre?: string | null;
  reserva_id?: number | null;
  origen_texto?: string | null;
  destino_texto?: string | null;
  origen?: Coord | null;
  destino?: Coord | null;
};

// Carga Leaflet (CSS + JS) desde CDN una sola vez.
const ensureLeaflet = (): Promise<any> =>
  new Promise((resolve, reject) => {
    const w = window as any;
    if (w.L) { resolve(w.L); return; }
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const existing = document.getElementById("leaflet-js") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).L));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => resolve((window as any).L);
    script.onerror = reject;
    document.body.appendChild(script);
  });

export default function AdminRutaPage() {
  const { checkingSession } = useAdminGuard();
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Record<number, any>>({});
  const rutasRef = useRef<Record<number, any>>({});
  const etaThrottleRef = useRef<Record<number, number>>({});
  const flotaVistaRef = useRef("");
  const selectedIdRef = useRef<number | null>(null);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [etas, setEtas] = useState<Record<number, { min: number; km: number }>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Resalta la ruta seleccionada (roja y gruesa) y atenúa las demás. Lee el id
  // desde el ref para poder llamarse también desde callbacks asíncronos.
  const resaltarRutas = () => {
    const sel = selectedIdRef.current;
    Object.entries(rutasRef.current).forEach(([idStr, line]) => {
      if (!line || typeof (line as any).setStyle !== "function") return;
      const id = Number(idStr);
      if (sel == null) (line as any).setStyle({ color: "#2563EB", weight: 4, opacity: 0.6 });
      else if (id === sel) (line as any).setStyle({ color: "#E31E24", weight: 6, opacity: 0.95 });
      else (line as any).setStyle({ color: "#94a3b8", weight: 3, opacity: 0.15 });
    });
  };

  // Aplica el resaltado al cambiar la selección o al llegar nuevas ubicaciones.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    resaltarRutas();
  }, [selectedId, ubicaciones]);

  const seleccionarVehiculo = (u: Ubicacion) => {
    const next = selectedId === u.vehiculo_id ? null : u.vehiculo_id;
    setSelectedId(next);
    const m = mapRef.current;
    if (!m || next == null) return;
    const line = rutasRef.current[u.vehiculo_id];
    if (line && typeof line.getBounds === "function") m.fitBounds(line.getBounds(), { padding: [50, 50] });
    else m.setView([Number(u.lat), Number(u.lng)], 15);
  };

  // Inicializa el mapa
  useEffect(() => {
    if (checkingSession) return;
    let cancelled = false;
    ensureLeaflet().then((L) => {
      if (cancelled || !mapEl.current || mapRef.current) return;
      const map = L.map(mapEl.current).setView([-2.1709, -79.9224], 7); // Ecuador
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      setMapReady(true);
    }).catch(() => setMapReady(false));
    return () => { cancelled = true; };
  }, [checkingSession]);

  const load = async () => {
    try {
      const res = await fetch(`${API}/api/admin/ubicaciones`, { headers: getAuthHeaders() });
      if (handleUnauthorized(res.status)) return;
      if (res.ok) setUbicaciones(await res.json());
    } catch { /* silencio */ }
  };

  useAutoRefresh(load, { enabled: !checkingSession, intervalMs: POLL_MS });

  // Pinta/actualiza marcadores cuando cambian las ubicaciones
  useEffect(() => {
    const L = (window as any).L;
    const map = mapRef.current;
    if (!L || !map) return;

    const vivos = new Set(ubicaciones.map(u => u.vehiculo_id));
    // Quitar marcadores y rutas de vehículos que ya no reportan
    Object.keys(markersRef.current).forEach((idStr) => {
      const id = Number(idStr);
      if (!vivos.has(id)) { map.removeLayer(markersRef.current[id]); delete markersRef.current[id]; }
    });
    Object.keys(rutasRef.current).forEach((idStr) => {
      const id = Number(idStr);
      if (!vivos.has(id)) { map.removeLayer(rutasRef.current[id]); delete rutasRef.current[id]; }
    });

    const pts: any[] = [];
    ubicaciones.forEach((u) => {
      const lat = Number(u.lat), lng = Number(u.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      pts.push([lat, lng]);
      const popup = `<b>${u.placa}</b><br/>${u.modelo || u.tipo || ""}<br/>${u.conductor_nombre || "Sin conductor"}`;
      if (markersRef.current[u.vehiculo_id]) {
        markersRef.current[u.vehiculo_id].setLatLng([lat, lng]).setPopupContent(popup);
      } else {
        markersRef.current[u.vehiculo_id] = L.marker([lat, lng]).addTo(map).bindPopup(popup);
      }

      // Traza la ruta salida → destino de su viaje en curso (una sola vez).
      if (u.origen && u.destino && !rutasRef.current[u.vehiculo_id]) {
        rutasRef.current[u.vehiculo_id] = true; // marca para no repetir mientras resuelve
        calcularRuta(u.origen, u.destino).then((ruta) => {
          if (!ruta || !mapRef.current) return;
          rutasRef.current[u.vehiculo_id] = L.polyline(ruta.coords, { color: "#2563EB", weight: 4, opacity: 0.6 }).addTo(mapRef.current);
          setEtas((prev) => prev[u.vehiculo_id] ? prev : { ...prev, [u.vehiculo_id]: { min: ruta.duracionMin, km: ruta.distanciaKm } });
          resaltarRutas(); // respeta la selección actual si esta ruta se dibujó después
        });
      }

      // ETA desde la posición actual → destino (máx cada 15s por vehículo).
      if (u.destino) {
        const now = Date.now();
        if (now - (etaThrottleRef.current[u.vehiculo_id] || 0) > 15000) {
          etaThrottleRef.current[u.vehiculo_id] = now;
          calcularRuta({ lat, lng }, u.destino).then((ruta) => {
            if (ruta) setEtas((prev) => ({ ...prev, [u.vehiculo_id]: { min: ruta.duracionMin, km: ruta.distanciaKm } }));
          });
        }
      }
    });

    // Solo reencuadramos cuando cambia el CONJUNTO de vehículos en vivo (entra o
    // sale alguno), no en cada actualización de posición. Así los tiles no se
    // recargan cada 2s y el mapa deja de parpadear en blanco.
    const firmaFlota = ubicaciones.map(u => u.vehiculo_id).sort((a, b) => a - b).join(",");
    if (firmaFlota !== flotaVistaRef.current) {
      flotaVistaRef.current = firmaFlota;
      if (pts.length === 1) map.setView(pts[0], 14);
      else if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] });
    }
  }, [ubicaciones, mapReady]);

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={34} /></div>
  );

  return (
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* RESUMEN */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Vehículos en vivo</p>
          <p className="text-3xl font-black italic tracking-tighter text-emerald-600 mt-1">{ubicaciones.length}</p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Actualización</p>
          <p className="text-sm font-black text-slate-700 mt-2 flex items-center gap-1"><Clock size={13} />cada 2s</p>
        </div>
        <div className="hidden sm:block bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Mapa</p>
          <p className="text-sm font-black text-slate-700 mt-2 flex items-center gap-1"><Navigation size={13} />OpenStreetMap</p>
        </div>
      </div>

      {/* MAPA */}
      <div className="relative bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        <div ref={mapEl} className="w-full h-[420px] sm:h-[560px] z-0" />
        {ubicaciones.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-sm pointer-events-none">
            <Bus size={40} className="text-slate-300 mb-3" />
            <p className="font-black text-slate-400 uppercase italic text-sm">Ningún vehículo está compartiendo ubicación</p>
            <p className="text-xs text-slate-400 mt-1">Aparecerán aquí cuando un conductor active el seguimiento en un viaje activo.</p>
          </div>
        )}
      </div>

      {/* LISTA DE VEHÍCULOS */}
      {ubicaciones.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ubicaciones.map(u => (
            <button key={u.vehiculo_id}
              onClick={() => seleccionarVehiculo(u)}
              className={`text-left bg-white rounded-2xl border shadow-sm p-4 transition-all ${selectedId === u.vehiculo_id ? "border-[#E31E24] ring-2 ring-[#E31E24]/20" : "border-slate-200 hover:border-[#E31E24]"}`}>
              <div className="flex items-center gap-3">
                <div className="bg-emerald-50 p-2 rounded-xl"><Bus size={16} className="text-emerald-500" /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-slate-800 uppercase italic tracking-tighter">{u.placa}</p>
                  <p className="text-[10px] text-slate-400 truncate">{u.conductor_nombre || "Sin conductor"}</p>
                </div>
                {etas[u.vehiculo_id] && (
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-blue-600 flex items-center gap-1 justify-end"><Clock size={12} />{formatDuracion(etas[u.vehiculo_id].min)}</p>
                    <p className="text-[9px] text-slate-400">{etas[u.vehiculo_id].km.toFixed(1)} km</p>
                  </div>
                )}
              </div>
              {(u.origen_texto || u.destino_texto) && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-[10px] text-slate-500">
                  <MapPin size={11} className="text-emerald-500 shrink-0" />
                  <span className="truncate">{u.origen_texto || "—"}</span>
                  <ArrowRight size={10} className="text-slate-300 shrink-0" />
                  <MapPin size={11} className="text-[#E31E24] shrink-0" />
                  <span className="truncate">{u.destino_texto || "—"}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
