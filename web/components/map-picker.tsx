"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, Flag, Loader2, LocateFixed, Search } from "lucide-react";
import { ensureLeaflet, GeocodingResult, reverseGeocode, searchLocations } from "../lib/leaflet";
import { LocalizedContent } from "../lib/i18n";

export type Punto = { lat: number; lng: number; label: string };

// Selector de origen y destino en un mapa. El usuario hace clic para colocar
// los puntos (sin escribir). Hace geocodificación inversa para mostrar el nombre.
export function MapPicker({
  origin, destination, onChange, focusDestinationSignal = 0,
  pickupOnly = false, localized = false, addressSearch = false, onClear, tourTarget,
}: {
  origin: Punto | null;
  destination: Punto | null;
  onChange: (which: "origin" | "destination", val: Punto) => void;
  onClear?: (which: "origin" | "destination") => void;
  pickupOnly?: boolean;
  localized?: boolean;
  addressSearch?: boolean;
  tourTarget?: string;
  // Al incrementar este número (p.ej. tras autocompletar el origen por GPS),
  // el mapa cambia el foco a "destino" para que el usuario solo tenga que
  // seleccionar ese punto. Ignorado si no se usa.
  focusDestinationSignal?: number;
}) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markers = useRef<{ origin: any; destination: any }>({ origin: null, destination: null });
  const modeRef = useRef<"origin" | "destination">("origin");
  const [mode, setMode] = useState<"origin" | "destination">("origin");
  const [geocoding, setGeocoding] = useState(false);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [queries, setQueries] = useState({ origin: origin?.label || "", destination: destination?.label || "" });
  const [searchResults, setSearchResults] = useState<Record<"origin" | "destination", GeocodingResult[]>>({ origin: [], destination: [] });
  const [searching, setSearching] = useState<Record<"origin" | "destination", boolean>>({ origin: false, destination: false });
  const [searchErrors, setSearchErrors] = useState<Partial<Record<"origin" | "destination", string>>>({});
  const focusPoint = useRef<{ lat: number; lng: number } | null>(null);
  const firstFocusRun = useRef(true);

  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    if (firstFocusRun.current) { firstFocusRun.current = false; return; }
    setMode("destination");
  }, [focusDestinationSignal]);

  useEffect(() => {
    if (origin) setQueries((current) => ({ ...current, origin: origin.label }));
  }, [origin]);

  useEffect(() => {
    if (destination) setQueries((current) => ({ ...current, destination: destination.label }));
  }, [destination]);

  const setMarker = (L: any, map: any, which: "origin" | "destination", lat: number, lng: number) => {
    const color = which === "origin" ? "#16a34a" : "#E31E24";
    const icon = L.divIcon({
      className: "",
      html: `<div style="background:${color};width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
      iconSize: [22, 22], iconAnchor: [11, 22],
    });
    if (markers.current[which]) { markers.current[which].setLatLng([lat, lng]); }
    else { markers.current[which] = L.marker([lat, lng], { icon }).addTo(map); }
  };

  const handleSearchInput = (which: "origin" | "destination", value: string) => {
    setQueries((current) => ({ ...current, [which]: value }));
    setSearchResults((current) => ({ ...current, [which]: [] }));
    setSearchErrors((current) => ({ ...current, [which]: "" }));
    const selected = which === "origin" ? origin : destination;
    if (selected && value.trim() !== selected.label) onClear?.(which);
  };

  const searchAddress = async (which: "origin" | "destination") => {
    const query = queries[which].trim();
    if (query.length < 3) {
      setSearchErrors((current) => ({ ...current, [which]: "Escribe al menos 3 caracteres para buscar." }));
      return;
    }

    setSearching((current) => ({ ...current, [which]: true }));
    setSearchErrors((current) => ({ ...current, [which]: "" }));
    setSearchResults((current) => ({ ...current, [which]: [] }));
    try {
      const results = await searchLocations(query);
      setSearchResults((current) => ({ ...current, [which]: results }));
      if (results.length === 0) {
        setSearchErrors((current) => ({ ...current, [which]: "No se encontraron lugares en Ecuador. Prueba con otra búsqueda." }));
      }
    } catch (error) {
      setSearchErrors((current) => ({
        ...current,
        [which]: error instanceof Error ? error.message : "No se pudo buscar el lugar. Inténtalo de nuevo.",
      }));
    } finally {
      setSearching((current) => ({ ...current, [which]: false }));
    }
  };

  const selectSearchResult = (which: "origin" | "destination", result: GeocodingResult) => {
    const point: Punto = { lat: result.lat, lng: result.lng, label: result.label };
    onChange(which, point);
    setQueries((current) => ({ ...current, [which]: result.label }));
    setSearchResults((current) => ({ ...current, [which]: [] }));
    setSearchErrors((current) => ({ ...current, [which]: "" }));
    setMode(which);
    focusPoint.current = result;
    const L = (window as any).L;
    const map = mapRef.current;
    if (L && map) {
      setMarker(L, map, which, result.lat, result.lng);
      map.setView([result.lat, result.lng], 15);
      focusPoint.current = null;
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Tu dispositivo no permite obtener la ubicación actual.");
      return;
    }

    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude, longitude } = coords;
        const label = await reverseGeocode(latitude, longitude);
        const point: Punto = { lat: latitude, lng: longitude, label };
        const L = (window as any).L;
        const map = mapRef.current;
        if (L && map) {
          setMarker(L, map, "origin", latitude, longitude);
          map.setView([latitude, longitude], 16);
        }
        onChange("origin", point);
        setMode("origin");
        setLocating(false);
      },
      () => {
        setLocationError("No se pudo obtener tu ubicación. Revisa el permiso del navegador.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  useEffect(() => {
    let cancelled = false;
    ensureLeaflet().then((L) => {
      if (cancelled || !mapEl.current || mapRef.current) return;
      const map = L.map(mapEl.current).setView([-1.8312, -78.1834], 6); // Ecuador
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
      mapRef.current = map;
      setReady(true);

      map.on("click", async (e: any) => {
        const { lat, lng } = e.latlng;
        const which = modeRef.current;
        setMarker(L, map, which, lat, lng);
        setGeocoding(true);
        const label = await reverseGeocode(lat, lng);
        setGeocoding(false);
        onChange(which, { lat, lng, label });
        if (!pickupOnly) {
          // alternar automáticamente al siguiente punto
          setMode((m) => (m === "origin" ? "destination" : "origin"));
        }
      });
    }).catch(() => setReady(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pintar marcadores iniciales si vienen por props
  useEffect(() => {
    const L = (window as any).L; const map = mapRef.current;
    if (!L || !map) return;
    if (origin) setMarker(L, map, "origin", origin.lat, origin.lng);
    else if (markers.current.origin) {
      markers.current.origin.remove();
      markers.current.origin = null;
    }
    if (destination) setMarker(L, map, "destination", destination.lat, destination.lng);
    else if (markers.current.destination) {
      markers.current.destination.remove();
      markers.current.destination = null;
    }
    if (focusPoint.current) {
      map.setView([focusPoint.current.lat, focusPoint.current.lng], 15);
      focusPoint.current = null;
    }
  }, [ready, origin, destination]);

  return (
    <LocalizedContent enabled={localized}>
    <div className="space-y-2">
      {addressSearch && !pickupOnly && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["origin", "destination"] as const).map((which) => {
            const label = which === "origin" ? "Salida" : "Destino";
            const Icon = which === "origin" ? MapPin : Flag;
            return (
              <div key={which} className="space-y-1.5">
                <label htmlFor={`map-picker-${which}`} className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-slate-600">
                  <Icon size={14} className={which === "origin" ? "text-emerald-600" : "text-[#E31E24]"} />
                  {which === "origin" ? "Buscar salida" : "Buscar destino"}
                </label>
                <div className="flex gap-2">
                  <input
                    id={`map-picker-${which}`}
                    type="search"
                    value={queries[which]}
                    onChange={(event) => handleSearchInput(which, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void searchAddress(which);
                      }
                    }}
                    placeholder={which === "origin" ? "Ej.: Manta, Manabí" : "Ej.: Aeropuerto de Quito"}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 outline-none focus:border-[#E31E24]"
                  />
                  <button
                    type="button"
                    onClick={() => void searchAddress(which)}
                    disabled={searching[which]}
                    aria-label={`Buscar ${label.toLowerCase()}`}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    {searching[which] ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                    <span className="hidden sm:inline">{searching[which] ? "Buscando" : "Buscar"}</span>
                  </button>
                </div>
                {searchResults[which].length > 0 && (
                  <ul role="listbox" aria-label={`Resultados para ${label.toLowerCase()}`} className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                    {searchResults[which].map((result, index) => (
                      <li key={`${result.lat}-${result.lng}-${index}`} role="option" aria-selected="false">
                        <button
                          type="button"
                          onClick={() => selectSearchResult(which, result)}
                          className="w-full border-b border-slate-100 px-3 py-2.5 text-left text-xs font-medium leading-relaxed text-slate-700 last:border-0 hover:bg-slate-50"
                        >
                          {result.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {searchErrors[which] && <p role="status" className="text-[11px] font-semibold text-amber-700">{searchErrors[which]}</p>}
              </div>
            );
          })}
          <p className="text-[11px] font-medium text-slate-500 sm:col-span-2">
            Escribe una dirección y pulsa Buscar; luego selecciona un resultado. También puedes ajustar los puntos directamente en el mapa.
          </p>
        </div>
      )}

      {/* Selector de qué punto se está marcando */}
      {pickupOnly ? (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-[10px] font-black uppercase tracking-widest text-white">
            <MapPin size={14} /> Marcar punto de recogida
          </div>
          <button
            type="button"
            onClick={useCurrentLocation}
            disabled={locating}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 py-2.5 text-[10px] font-black uppercase tracking-widest text-blue-700 transition-all hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
          >
            {locating ? <Loader2 size={14} className="animate-spin" /> : <LocateFixed size={14} />}
            {locating ? "Obteniendo ubicación..." : "Usar ubicación actual"}
          </button>
          {locationError && <p className="text-center text-[10px] font-bold text-red-600">{locationError}</p>}
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("origin")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${mode === "origin" ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500"}`}>
            <MapPin size={14} /> Marcar salida
          </button>
          <button type="button" onClick={() => setMode("destination")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${mode === "destination" ? "bg-[#E31E24] text-white" : "bg-slate-100 text-slate-500"}`}>
            <Flag size={14} /> Marcar destino
          </button>
        </div>
      )}

      <div
        ref={mapEl}
        data-tour-target={tourTarget}
        className="z-0 h-64 w-full overflow-hidden rounded-2xl border-2 border-slate-200 sm:h-72"
      />

      <p className="text-[10px] text-slate-400 font-bold text-center">
        {geocoding ? <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Obteniendo dirección…</span>
          : `Haz clic en el mapa para fijar ${pickupOnly || mode === "origin" ? "el punto de recogida" : "el destino"}`}
      </p>

      <div className={pickupOnly ? "" : "grid grid-cols-2 gap-2"}>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
          <p className="text-[8px] font-black uppercase tracking-widest text-emerald-500 flex items-center gap-1"><MapPin size={9} /> {pickupOnly ? "Recogida" : "Salida"}</p>
          <p className="text-[11px] font-bold text-slate-700 truncate">{origin?.label || "Sin marcar"}</p>
        </div>
        {!pickupOnly && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-2.5">
            <p className="text-[8px] font-black uppercase tracking-widest text-[#E31E24] flex items-center gap-1"><Flag size={9} /> Destino</p>
            <p className="text-[11px] font-bold text-slate-700 truncate">{destination?.label || "Sin marcar"}</p>
          </div>
        )}
      </div>
    </div>
    </LocalizedContent>
  );
}
