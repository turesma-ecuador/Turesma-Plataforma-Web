"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, MapPin, Plus, Search, Trash2 } from "lucide-react";
import { ensureLeaflet, reverseGeocode, searchLocations } from "../lib/leaflet";
import type { Punto } from "./map-picker";

export type ItineraryDestination = Punto & {
  fecha_llegada: string;
  hora_salida: string;
  dias_estadia: number;
};

type Props = {
  origin: Punto | null;
  destinations: ItineraryDestination[];
  returnToOrigin: boolean;
  onOriginChange: (point: Punto | null) => void;
  onDestinationsChange: (points: ItineraryDestination[]) => void;
  onReturnToOriginChange: (value: boolean) => void;
};

export function ItineraryMapPicker({
  origin,
  destinations,
  returnToOrigin,
  onOriginChange,
  onDestinationsChange,
  onReturnToOriginChange,
}: Props) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routeRef = useRef<any>(null);
  const [mode, setMode] = useState<"origin" | "destination">(origin ? "destination" : "origin");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<Punto & { label: string }>>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [error, setError] = useState("");

  const selectionRef = useRef({ mode, origin, destinations });
  useEffect(() => {
    selectionRef.current = { mode, origin, destinations };
  }, [mode, origin, destinations]);

  const addDestination = useCallback((point: Punto) => {
    const currentDestinations = selectionRef.current.destinations;
    if (currentDestinations.length >= 10) {
      setError("Puedes agregar hasta 10 destinos intermedios.");
      return;
    }
    const nextDestinations = [
      ...currentDestinations,
      { ...point, fecha_llegada: "", hora_salida: "", dias_estadia: 0 },
    ];
    selectionRef.current = { ...selectionRef.current, mode: "destination", destinations: nextDestinations };
    onDestinationsChange(nextDestinations);
    setMode("destination");
    setQuery("");
    setResults([]);
  }, [onDestinationsChange]);

  const addPointFromMap = useCallback(async (lat: number, lng: number) => {
    setMapBusy(true);
    setError("");
    try {
      const point = { lat, lng, label: await reverseGeocode(lat, lng) };
      if (selectionRef.current.mode === "origin" || !selectionRef.current.origin) {
        onOriginChange(point);
        setMode("destination");
      }
      else addDestination(point);
    } finally {
      setMapBusy(false);
    }
  }, [addDestination, onOriginChange]);
  const addPointFromMapRef = useRef(addPointFromMap);
  useEffect(() => {
    addPointFromMapRef.current = addPointFromMap;
  }, [addPointFromMap]);

  const search = async () => {
    if (query.trim().length < 3) {
      setError("Escribe al menos 3 caracteres para buscar un lugar.");
      return;
    }
    setLoadingSearch(true);
    setError("");
    try {
      const found = await searchLocations(query);
      setResults(found);
      if (!found.length) setError("No se encontraron lugares. Prueba con otra búsqueda.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo buscar el lugar.");
    } finally {
      setLoadingSearch(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void ensureLeaflet().then((leaflet) => {
      if (cancelled || !mapElement.current || mapRef.current) return;
      const map = leaflet.map(mapElement.current).setView([-1.8312, -78.1834], 6);
      leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);
      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        void addPointFromMapRef.current(event.latlng.lat, event.latlng.lng);
      });
      mapRef.current = map;
      setMapReady(true);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "No se pudo cargar el mapa.");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const leaflet = (window as Window & { L?: any }).L;
    if (!leaflet) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    if (routeRef.current) routeRef.current.remove();

    const points = [origin, ...destinations].filter((point): point is Punto => Boolean(point));
    points.forEach((point, index) => {
      const color = index === 0 ? "#16a34a" : "#E31E24";
      const icon = leaflet.divIcon({
        className: "",
        html: `<div style="background:${color};color:white;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px #0006;font-weight:700;font-size:12px">${index === 0 ? "S" : index}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      markersRef.current.push(leaflet.marker([point.lat, point.lng], { icon }).addTo(mapRef.current));
    });
    const routePoints = returnToOrigin && origin && destinations.length
      ? [...points, origin]
      : points;
    if (routePoints.length > 1) {
      routeRef.current = leaflet.polyline(routePoints.map((point) => [point.lat, point.lng]), {
        color: "#2563eb",
        weight: 4,
        dashArray: "7 7",
      }).addTo(mapRef.current);
    }
    if (routePoints.length) {
      mapRef.current.fitBounds(routePoints.map((point) => [point.lat, point.lng]), { padding: [24, 24] });
    }
  }, [destinations, mapReady, origin, returnToOrigin]);

  const updateDestination = (index: number, patch: Partial<ItineraryDestination>) => {
    onDestinationsChange(destinations.map((point, pointIndex) =>
      pointIndex === index ? { ...point, ...patch } : point
    ));
  };
  const moveDestination = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= destinations.length) return;
    const reordered = [...destinations];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onDestinationsChange(reordered);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-blue-200 bg-blue-50/50 p-4">
      <div>
        <h3 className="text-sm font-black text-blue-950">Ruta con varios destinos</h3>
        <p className="mt-1 text-xs leading-relaxed text-blue-900">
          Agrega y ordena las paradas en el mapa. Si necesitas estadías, selecciona “Varios días” en las fechas.
          Administración confirmará disponibilidad y preparará la proforma.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setMode("origin")} aria-pressed={mode === "origin"}
          className={`rounded-xl px-3 py-2 text-xs font-black ${mode === "origin" ? "bg-emerald-600 text-white" : "bg-white text-slate-600"}`}>
          Marcar origen en el mapa
        </button>
        <button type="button" onClick={() => setMode("destination")} aria-pressed={mode === "destination"}
          disabled={destinations.length >= 10}
          className={`rounded-xl px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50 ${mode === "destination" ? "bg-red-600 text-white" : "bg-white text-slate-600"}`}>
          Agregar destino en el mapa ({destinations.length}/10)
        </button>
      </div>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="itinerary-location-search">Buscar ciudad o dirección</label>
        <input id="itinerary-location-search" value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}
          placeholder={mode === "origin" ? "Buscar punto de salida" : "Buscar siguiente destino"}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" />
        <button type="button" onClick={() => void search()} disabled={loadingSearch}
          className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          {loadingSearch ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar
        </button>
      </div>
      {results.length > 0 && (
        <ul className="max-h-40 overflow-auto rounded-xl border border-slate-200 bg-white">
          {results.map((point, index) => (
            <li key={`${point.lat}-${point.lng}-${index}`}>
              <button type="button" onClick={() => {
                if (mode === "origin" || !origin) {
                  onOriginChange(point);
                  setMode("destination");
                }
                else addDestination(point);
                setResults([]);
                setQuery("");
              }} className="w-full border-b border-slate-100 p-2.5 text-left text-xs hover:bg-slate-50">
                {point.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs font-semibold text-amber-800">{error}</p>}
      <div ref={mapElement} className="h-64 w-full rounded-xl border border-slate-200 bg-slate-100 sm:h-72" />
      {mapBusy && <p role="status" className="text-xs font-semibold text-blue-800"><Loader2 size={13} className="mr-1 inline animate-spin" />Obteniendo dirección...</p>}
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-white p-3">
          <MapPin size={15} className="mt-0.5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-wide text-emerald-700">Origen</p>
            <p className="text-xs font-semibold text-slate-700">{origin?.label || "Marca o busca el punto de salida"}</p>
          </div>
          {origin && <button type="button" onClick={() => onOriginChange(null)} aria-label="Quitar origen" className="text-xs font-bold text-red-600">Quitar</button>}
        </div>
        {destinations.map((point, index) => (
          <section key={`${point.lat}-${point.lng}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start gap-2">
              <MapPin size={15} className="mt-0.5 shrink-0 text-red-600" />
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-black uppercase tracking-wide text-red-700">Destino {index + 1}</p>
                <p className="break-words text-xs font-semibold text-slate-700">{point.label}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" disabled={index === 0} onClick={() => moveDestination(index, -1)} aria-label={`Mover destino ${index + 1} arriba`}
                  className="rounded p-1 text-slate-500 disabled:opacity-30"><ArrowUp size={14} /></button>
                <button type="button" disabled={index === destinations.length - 1} onClick={() => moveDestination(index, 1)} aria-label={`Mover destino ${index + 1} abajo`}
                  className="rounded p-1 text-slate-500 disabled:opacity-30"><ArrowDown size={14} /></button>
                <button type="button" onClick={() => onDestinationsChange(destinations.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label={`Quitar destino ${index + 1}`} className="rounded p-1 text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label className="text-[9px] font-black uppercase text-slate-500">Llegada (opcional)
                <input type="date" value={point.fecha_llegada} onChange={(event) => updateDestination(index, { fecha_llegada: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs font-semibold" />
              </label>
              <label className="text-[9px] font-black uppercase text-slate-500">Días de estadía (si aplica)
                <input type="number" min={0} max={365} value={point.dias_estadia}
                  onChange={(event) => updateDestination(index, { dias_estadia: Math.max(0, Math.min(365, Number(event.target.value) || 0)) })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs font-semibold" />
              </label>
              <label className="text-[9px] font-black uppercase text-slate-500">Hora al salir
                <input type="time" value={point.hora_salida} onChange={(event) => updateDestination(index, { hora_salida: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs font-semibold" />
              </label>
            </div>
          </section>
        ))}
        <button type="button" onClick={() => setMode("destination")} disabled={!origin}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-black text-blue-800 disabled:opacity-50">
          <Plus size={14} /> Agregar otro destino (buscar o marcar en el mapa)
        </button>
        <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={returnToOrigin} onChange={(event) => onReturnToOriginChange(event.target.checked)}
            className="mt-0.5 accent-blue-700" />
          Incluir retorno al punto de salida{origin ? ` (${origin.label})` : ""}
        </label>
      </div>
    </div>
  );
}
