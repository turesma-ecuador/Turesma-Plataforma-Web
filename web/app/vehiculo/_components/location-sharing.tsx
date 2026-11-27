"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { useEffect, useRef, useState } from "react";
import { Navigation, Loader2, Radio, Clock, MapPin } from "lucide-react";
import { getAuthHeaders } from "../../../lib/session";
import { ensureLeaflet, calcularRuta, formatDuracion } from "../../../lib/leaflet";

const API = API_BASE_URL;

const SEND_INTERVAL_MS = 2000;

type Destino = { lat: number; lng: number; texto?: string | null };

// Toggle para compartir la ubicación del conductor en tiempo real + mapa con
// su posición. Envía coordenadas cada 2s al backend, que las muestra al
// administrador y al cliente. Si recibe el destino del viaje en curso, dibuja
// la ruta y calcula el tiempo estimado de llegada.
export function LocationSharing({ userId, destino }: { userId?: number; destino?: Destino | null }) {
  const [sharing, setSharing] = useState(false);
  const [status, setStatus] = useState("");
  const [sentCount, setSentCount] = useState(0);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const marker = useRef<any>(null);
  const destinoMarker = useRef<any>(null);
  const rutaLine = useRef<any>(null);
  const centeredRef = useRef(false);
  const etaThrottle = useRef(0);
  const lastRouteTargetRef = useRef<{ lat: number; lng: number } | null>(null);
  const [eta, setEta] = useState<{ min: number; km: number } | null>(null);

  const send = async (lat: number, lng: number) => {
    if (!userId) return;
    try {
      await fetch(`${API}/api/conductor/${userId}/ubicacion`, {
        method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ lat, lng }),
      });
      setSentCount((c) => c + 1);
    } catch { /* silencio */ }
  };

  const start = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("Tu dispositivo no soporta geolocalización"); return;
    }
    setSharing(true);
    centeredRef.current = false;
    setStatus("Obteniendo tu ubicación…");
    // Recuerda que estaba compartiendo para reactivarlo solo tras recargar.
    try { localStorage.setItem("conductor_ubicacion_sharing", "1"); } catch { /* noop */ }
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setStatus("Compartiendo ubicación en tiempo real");
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        const now = Date.now();
        if (now - lastSent.current > SEND_INTERVAL_MS) {
          lastSent.current = now;
          send(p.coords.latitude, p.coords.longitude);
        }
      },
      (e) => {
        setStatus("No se pudo obtener tu ubicación: " + e.message);
        setSharing(false);
        try { localStorage.removeItem("conductor_ubicacion_sharing"); } catch { /* noop */ }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  };

  const stop = () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
    setStatus("");
    try { localStorage.removeItem("conductor_ubicacion_sharing"); } catch { /* noop */ }
  };

  useEffect(() => () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); }, []);

  // Al recargar la página, si el conductor estaba compartiendo su ubicación,
  // se reactiva solo (el navegador ya tiene el permiso concedido), para que el
  // mapa y la ruta no se pierdan.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let resumed = false;
    try {
      if (localStorage.getItem("conductor_ubicacion_sharing") === "1") resumed = true;
    } catch { /* noop */ }
    if (resumed) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inicializa el mapa cuando se empieza a compartir
  useEffect(() => {
    if (!sharing) return;
    let cancelled = false;
    ensureLeaflet().then((L) => {
      if (cancelled || !mapEl.current || mapRef.current) return;
      const map = L.map(mapEl.current).setView(pos ? [pos.lat, pos.lng] : [-1.8312, -78.1834], pos ? 15 : 7);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
      mapRef.current = map;
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing]);

  // Actualiza el marcador con la posición. Centra una sola vez y luego solo
  // sigue al conductor si sale de la vista, para que el mapa no recargue los
  // tiles ni parpadee en blanco en cada actualización.
  useEffect(() => {
    const L = (window as any).L; const map = mapRef.current;
    if (!L || !map || !pos) return;
    const ll: [number, number] = [pos.lat, pos.lng];
    if (marker.current) marker.current.setLatLng(ll);
    else {
      const icon = L.divIcon({ className: "", html: `<div style="background:#2563EB;width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
      marker.current = L.marker(ll, { icon }).addTo(map);
    }
    if (!centeredRef.current) {
      map.setView(ll, 15);
      centeredRef.current = true;
    } else if (!map.getBounds().pad(-0.25).contains(ll)) {
      map.panTo(ll, { animate: true });
    }

    // Si hay destino del viaje en curso: marcador de destino, ruta hasta él y
    // tiempo estimado de llegada (recalculado como máximo cada 15s).
    if (destino) {
      const dll: [number, number] = [destino.lat, destino.lng];
      const etiqueta = destino.texto || "Destino";
      if (destinoMarker.current) {
        destinoMarker.current.setLatLng(dll);
        destinoMarker.current.setPopupContent(etiqueta);
      } else {
        const dicon = L.divIcon({ className: "", html: `<div style="background:#E31E24;width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`, iconSize: [18, 18], iconAnchor: [9, 18] });
        destinoMarker.current = L.marker(dll, { icon: dicon }).addTo(map).bindPopup(etiqueta);
      }
      const now = Date.now();
      // Fuerza recalcular la ruta si cambió el objetivo (recoger → destino),
      // aunque no haya pasado el intervalo normal de 15s.
      const targetChanged = !lastRouteTargetRef.current
        || lastRouteTargetRef.current.lat !== destino.lat
        || lastRouteTargetRef.current.lng !== destino.lng;
      if (targetChanged || now - etaThrottle.current > 15000) {
        etaThrottle.current = now;
        lastRouteTargetRef.current = { lat: destino.lat, lng: destino.lng };
        calcularRuta({ lat: pos.lat, lng: pos.lng }, destino).then((ruta) => {
          if (!ruta || !mapRef.current) return;
          if (rutaLine.current) rutaLine.current.setLatLngs(ruta.coords);
          else rutaLine.current = L.polyline(ruta.coords, { color: "#2563EB", weight: 4, opacity: 0.6 }).addTo(mapRef.current);
          setEta({ min: ruta.duracionMin, km: ruta.distanciaKm });
        });
      }
    }
  }, [pos, destino]);

  return (
    <div className={`rounded-2xl border-2 p-4 sm:p-5 transition-all ${sharing ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200"}`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl ${sharing ? "bg-emerald-500 text-white animate-pulse" : "bg-slate-100 text-slate-500"}`}>
            {sharing ? <Radio size={20} /> : <Navigation size={20} />}
          </div>
          <div>
            <p className="font-black text-slate-800 uppercase italic tracking-tighter text-sm">Compartir ubicación</p>
            <p className="text-[11px] text-slate-500 font-bold">
              {status || "Permite que el administrador y el cliente vean tu posición durante el viaje"}
              {sharing && sentCount > 0 && <span className="text-emerald-600"> · {sentCount} envíos</span>}
            </p>
          </div>
        </div>
        {!sharing ? (
          <button onClick={start} className="px-5 py-2.5 rounded-xl bg-[#E31E24] hover:bg-black text-white text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2">
            <Navigation size={14} /> Activar
          </button>
        ) : (
          <button onClick={stop} className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Detener
          </button>
        )}
      </div>

      {/* Tiempo estimado de llegada al destino */}
      {sharing && destino && eta && (
        <div className="mt-3 flex items-center justify-between gap-2 bg-white rounded-xl border border-emerald-200 px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5 text-slate-500 min-w-0">
            <MapPin size={13} className="text-[#E31E24] shrink-0" />
            <span className="truncate">{destino.texto || "Destino"}</span>
          </span>
          <span className="flex items-center gap-1.5 font-black text-blue-600 shrink-0">
            <Clock size={13} /> {formatDuracion(eta.min)} · {eta.km.toFixed(1)} km
          </span>
        </div>
      )}

      {/* Mapa con la posición del conductor */}
      {sharing && (
        <div className="mt-4 rounded-2xl overflow-hidden border-2 border-emerald-200">
          <div ref={mapEl} className="w-full h-56 sm:h-64 z-0" />
        </div>
      )}
    </div>
  );
}
