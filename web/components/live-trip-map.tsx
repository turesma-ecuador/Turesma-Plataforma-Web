"use client";


import { API_BASE_URL } from "@/lib/api-url";
import { useEffect, useRef, useState } from "react";
import { Loader2, Bus, Flag, MapPin, Phone, RefreshCw, Clock, Navigation } from "lucide-react";
import { ensureLeaflet, calcularRuta, formatDuracion } from "../lib/leaflet";
import { getAuthHeaders } from "../lib/session";
import { WhatsAppButton } from "./whatsapp-button";
import { LocalizedContent, useLocale } from "../lib/i18n";

const API = API_BASE_URL;
const POLL_MS = 2000;

type Seguimiento = {
  estado: string; placa?: string | null; modelo?: string | null;
  conductor_nombre?: string | null; conductor_telefono?: string | null;
  vehiculo: { lat: number; lng: number; creado_en: string } | null;
  origen: { lat: number; lng: number } | null;
  destino: { lat: number; lng: number } | null;
};

// Mapa de seguimiento en vivo para el cliente: muestra la posición del vehículo
// de su reserva en tiempo real (poll cada 2s) + el destino.
export function LiveTripMap({ reservaId }: { reservaId: number }) {
  const { language } = useLocale();
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const vehMarker = useRef<any>(null);
  const origenMarker = useRef<any>(null);
  const destinoMarker = useRef<any>(null);
  const rutaLine = useRef<any>(null);
  const centeredRef = useRef(false);
  const rutaDibujadaRef = useRef(false);
  const ultimoEtaRef = useRef(0);
  const [data, setData] = useState<Seguimiento | null>(null);
  const [loading, setLoading] = useState(true);
  const [eta, setEta] = useState<{ min: number; km: number } | null>(null);

  const pin = (L: any, color: string) => L.divIcon({
    className: "",
    html: `<div style="background:${color};width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
    iconSize: [20, 20], iconAnchor: [10, 20],
  });

  const load = async () => {
    try {
      const res = await fetch(`${API}/api/usuarios/mis-reservas/${reservaId}/ubicacion`, { headers: getAuthHeaders() });
      if (res.ok) setData(await res.json());
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  // init map + poll
  useEffect(() => {
    let cancelled = false;
    ensureLeaflet().then((L) => {
      if (cancelled || !mapEl.current || mapRef.current) return;
      const map = L.map(mapEl.current).setView([-1.8312, -78.1834], 7);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
      mapRef.current = map;
    }).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservaId]);

  // actualizar marcadores (sin recrearlos ni recentrar en cada poll, para que
  // el mapa no recargue los tiles y parpadee en blanco)
  useEffect(() => {
    const L = (window as any).L; const map = mapRef.current;
    if (!L || !map || !data) return;
    const pts: any[] = [];

    // Destino y salida: se crean una sola vez y luego se reutilizan
    if (data.destino) {
      const ll: [number, number] = [data.destino.lat, data.destino.lng];
      if (destinoMarker.current) destinoMarker.current.setLatLng(ll);
      else destinoMarker.current = L.marker(ll, { icon: pin(L, "#E31E24") }).addTo(map).bindPopup("Destino");
      pts.push(ll);
    }
    if (data.origen) {
      const ll: [number, number] = [data.origen.lat, data.origen.lng];
      if (origenMarker.current) origenMarker.current.setLatLng(ll);
      else origenMarker.current = L.marker(ll, { icon: pin(L, "#16a34a") }).addTo(map).bindPopup("Salida");
      pts.push(ll);
    }
    if (data.vehiculo) {
      const ll: [number, number] = [Number(data.vehiculo.lat), Number(data.vehiculo.lng)];
      if (vehMarker.current) vehMarker.current.setLatLng(ll);
      else vehMarker.current = L.marker(ll, { icon: pin(L, "#2563EB") }).addTo(map).bindPopup(`${data.placa || "Vehículo"}`);
      pts.push(ll);

      // Encuadra una sola vez; después solo sigue al vehículo si se sale de vista
      if (!centeredRef.current) {
        map.setView(ll, 14);
        centeredRef.current = true;
      } else if (!map.getBounds().pad(-0.25).contains(ll)) {
        map.panTo(ll, { animate: true });
      }
    } else if (!centeredRef.current && pts.length) {
      map.fitBounds(pts, { padding: [40, 40] });
      centeredRef.current = true;
    }

    // Traza la ruta real (por carretera) de salida → destino una sola vez.
    if (!rutaDibujadaRef.current && data.origen && data.destino) {
      rutaDibujadaRef.current = true;
      calcularRuta(data.origen, data.destino).then((ruta) => {
        if (!ruta || !mapRef.current) return;
        rutaLine.current = L.polyline(ruta.coords, { color: "#2563EB", weight: 5, opacity: 0.65 }).addTo(mapRef.current);
        setEta((prev) => prev ?? { min: ruta.duracionMin, km: ruta.distanciaKm });
      });
    }

    // Tiempo estimado de llegada: desde la posición actual del vehículo hasta el
    // destino. Se recalcula como máximo cada 15s para no saturar el servicio.
    if (data.vehiculo && data.destino) {
      const now = Date.now();
      if (now - ultimoEtaRef.current > 15000) {
        ultimoEtaRef.current = now;
        calcularRuta({ lat: Number(data.vehiculo.lat), lng: Number(data.vehiculo.lng) }, data.destino)
          .then((ruta) => { if (ruta) setEta({ min: ruta.duracionMin, km: ruta.distanciaKm }); });
      }
    }
  }, [data]);

  const sinUbicacion = !data?.vehiculo;
  const ultima = data?.vehiculo?.creado_en ? new Date(data.vehiculo.creado_en).toLocaleTimeString(language === "en" ? "en-US" : "es-EC", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <LocalizedContent>
    <div className="bg-white rounded-2xl border-2 border-blue-200 shadow-sm overflow-hidden">
      <div className="bg-[#0b0f1a] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-blue-500 p-1.5 rounded-lg animate-pulse"><Bus size={14} className="text-white" /></div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-white">Seguimiento en vivo</p>
            <p className="text-[9px] text-gray-400">{data?.placa || "Vehículo"} {ultima && `· actualizado ${ultima}`}</p>
          </div>
        </div>
        <button onClick={load} className="text-gray-400 hover:text-white"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
      </div>
      {/* Tiempo estimado de llegada */}
      {eta && (
        <div className="flex items-center justify-center gap-4 bg-blue-50 border-b border-blue-100 px-4 py-2.5 text-xs">
          <span className="flex items-center gap-1.5 font-bold text-blue-700">
            <Clock size={14} /> Llega en ~{formatDuracion(eta.min)}
          </span>
          <span className="flex items-center gap-1.5 text-slate-500">
            <Navigation size={13} /> {eta.km.toFixed(1)} km
          </span>
        </div>
      )}
      <div className="relative">
        <div ref={mapEl} className="w-full h-64 sm:h-80 z-0" />
        {sinUbicacion && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/70 backdrop-blur-sm pointer-events-none text-center px-4">
            {loading ? <Loader2 size={28} className="animate-spin text-[#E31E24]" /> : (
              <>
                <MapPin size={30} className="text-slate-300 mb-2" />
                <p className="text-xs font-black uppercase text-slate-400 italic">El conductor aún no comparte su ubicación</p>
              </>
            )}
          </div>
        )}
      </div>
      {(data?.conductor_nombre || data?.destino) && (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-[11px] border-t border-slate-100">
          <span className="font-bold text-slate-700 flex items-center gap-1">
            {data?.conductor_nombre || "Conductor por asignar"}
            {data?.conductor_telefono && <span className="text-slate-400 flex items-center gap-1 ml-2"><Phone size={11} />{data.conductor_telefono}</span>}
            {data?.conductor_telefono && <WhatsAppButton telefono={data.conductor_telefono} title={`WhatsApp de ${data?.conductor_nombre || "conductor"}`} mensaje="Hola, le escribo por mi viaje en curso con Turesma." />}
          </span>
          {data?.destino && <span className="text-[#E31E24] font-black flex items-center gap-1"><Flag size={11} /> Destino fijado</span>}
        </div>
      )}
    </div>
    </LocalizedContent>
  );
}
