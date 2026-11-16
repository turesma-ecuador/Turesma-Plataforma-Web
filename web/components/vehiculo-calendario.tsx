"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { LocalizedContent, useLocale } from "../lib/i18n";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const DIAS = ["D", "L", "M", "X", "J", "V", "S"];

const iso = (d: Date) => [
  d.getFullYear(),
  String(d.getMonth() + 1).padStart(2, "0"),
  String(d.getDate()).padStart(2, "0"),
].join("-");
// Suma días a una fecha ISO (YYYY-MM-DD) sin problemas de zona horaria.
const addDaysIso = (isoDate: string, n: number) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return iso(dt);
};

// Permite elegir fechas y, cuando hay una unidad concreta, muestra sus días no disponibles.
export function VehiculoCalendario({
  vehiculoId, value, onSelect, range = false, endValue = "", onSelectEnd, maxDays = 0, allowUnassigned = false, localized = false, minDate = "", selectionLabel = "", secondaryValue = "", secondaryLabel = "",
}: {
  vehiculoId: number | null;
  value: string;
  onSelect: (fecha: string) => void;
  range?: boolean;
  endValue?: string;
  onSelectEnd?: (fecha: string) => void;
  maxDays?: number; // tope de días seguidos en modo rango (0 = sin tope)
  allowUnassigned?: boolean;
  localized?: boolean;
  minDate?: string;
  selectionLabel?: string;
  secondaryValue?: string;
  secondaryLabel?: string;
}) {
  const [dispo, setDispo] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [aviso, setAviso] = useState("");
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const { language } = useLocale();

  useEffect(() => {
    if (!vehiculoId || allowUnassigned) return;
    setLoading(true);
    const desde = iso(new Date());
    const hastaD = new Date(); hastaD.setDate(hastaD.getDate() + 90);
    fetch(`${API}/api/usuarios/vehiculos/${vehiculoId}/disponibilidad?desde=${desde}&hasta=${iso(hastaD)}`)
      .then(r => r.ok ? r.json() : [])
      .then((rows: { fecha: string; disponible: boolean }[]) => {
        const map: Record<string, boolean> = {};
        rows.forEach(r => { map[String(r.fecha).slice(0, 10)] = !!r.disponible; });
        setDispo(map);
      })
      .catch(() => setDispo({}))
      .finally(() => setLoading(false));
  }, [vehiculoId, allowUnassigned]);

  const hoy = iso(new Date());
  const fechaMinima = minDate > hoy ? minDate : hoy;
  const esLibre = (f: string) => f >= fechaMinima
    && (!vehiculoId || allowUnassigned || dispo[f] === undefined || dispo[f] === true);

  // ¿Están libres TODOS los días entre a y b (inclusive)? Para validar el rango.
  const rangoLibre = (a: string, b: string) => {
    let cur = a;
    while (cur <= b) { if (!esLibre(cur)) return false; cur = addDaysIso(cur, 1); }
    return true;
  };
  // Días que abarca el rango a..b (ambos extremos incluidos).
  const diasRango = (a: string, b: string) => {
    const d1 = new Date(a + "T00:00").getTime(), d2 = new Date(b + "T00:00").getTime();
    return Math.round((d2 - d1) / 86400000) + 1;
  };

  const dias = useMemo(() => {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startDow = first.getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) cells.push(iso(new Date(year, month, d)));
    return cells;
  }, [cursor]);

  const cambiarMes = (delta: number) => setCursor(c => new Date(c.getFullYear(), c.getMonth() + delta, 1));

  const clickDia = (f: string) => {
    if (!esLibre(f)) return;
    if (!range) { setAviso(""); onSelect(f); return; }
    setAviso("");
    // Modo rango: primer clic = inicio; segundo clic válido = fin.
    if (!value || (value && endValue)) {
      onSelect(f); onSelectEnd?.("");
      return;
    }
    if (f === value) return;
    if (f > value) {
      if (maxDays > 0 && diasRango(value, f) > maxDays) {
        setAviso(`Máximo ${maxDays} días seguidos por reserva.`);
        return;
      }
      if (rangoLibre(value, f)) { onSelectEnd?.(f); return; }
      setAviso("El rango incluye fechas no disponibles. Elige otro rango.");
      return;
    }
    // clic anterior al inicio o con días ocupados en medio → reinicia el rango
    onSelect(f); onSelectEnd?.("");
  };

  if (!vehiculoId && !allowUnassigned) {
    return <LocalizedContent enabled={localized}><div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center text-xs font-bold text-slate-400">Selecciona un vehículo para ver sus días disponibles</div></LocalizedContent>;
  }

  return (
    <LocalizedContent enabled={localized}>
      <div className="mx-auto max-w-[720px] rounded-2xl border-2 border-slate-100 bg-white p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button type="button" onClick={() => cambiarMes(-1)} aria-label={localized && language === "en" ? "Previous month" : "Mes anterior"} className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100">
            <ChevronLeft size={18} />
          </button>
          <p className="text-sm font-black uppercase italic tracking-tight text-slate-800">
            {cursor.toLocaleDateString(localized && language === "en" ? "en-US" : "es-EC", { month: "long", year: "numeric" })}
          </p>
          <button type="button" onClick={() => cambiarMes(1)} aria-label={localized && language === "en" ? "Next month" : "Mes siguiente"} className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="mb-3 flex min-h-10 items-center justify-center rounded-xl bg-slate-50 px-3 py-2 text-center text-xs font-bold text-slate-700" aria-live="polite">
          {selectionLabel
            ? value
              ? `${selectionLabel}: ${new Date(`${value}T00:00:00`).toLocaleDateString(localized && language === "en" ? "en-US" : "es-EC", { day: "numeric", month: "long", year: "numeric" })}`
              : `Selecciona ${selectionLabel.toLowerCase()}`
            : range
              ? !value ? "Elige la fecha de salida" : !endValue ? "Ahora elige el último día del servicio" : "Rango listo · elige otra fecha para empezar de nuevo"
              : value
                ? `Fecha seleccionada: ${new Date(`${value}T00:00:00`).toLocaleDateString(localized && language === "en" ? "en-US" : "es-EC", { day: "numeric", month: "long", year: "numeric" })}`
                : "Elige el día de tu viaje"}
          {range && maxDays > 0 && <span className="ml-1 font-medium text-slate-500">· máximo {maxDays} días</span>}
        </div>
        {aviso && <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-center text-xs font-bold text-red-700">{aviso}</p>}

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-[#E31E24]" size={24} /></div>
        ) : (
          <>
            <div className="mx-auto grid max-w-[680px] grid-cols-7 gap-1.5">
              {(localized && language === "en" ? ["S", "M", "T", "W", "T", "F", "S"] : DIAS).map((day, i) => (
                <div key={i} className="py-1 text-center text-[10px] font-black uppercase text-slate-500">
                  <span aria-hidden="true">{day}</span>
                  <span className="sr-only">{(localized && language === "en" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] : ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"])[i]}</span>
                </div>
              ))}
              {dias.map((date, i) => {
                if (!date) return <span key={`empty-${i}`} aria-hidden="true" className="h-12 sm:h-14" />;
                const dayNum = Number(date.slice(8, 10));
                const past = date < hoy;
                const beforeMinDate = !past && date < fechaMinima;
                const libre = esLibre(date);
                const reservado = dispo[date] === false && !past;
                const isStart = value === date;
                const isEnd = !!endValue && endValue === date;
                const isSecondary = !!secondaryValue && secondaryValue === date;
                const inRange = range && !!value && !!endValue && date > value && date < endValue;
                const selected = isStart || isEnd || isSecondary;
                const today = date === hoy;
                const marker = isSecondary && secondaryLabel
                  ? secondaryLabel
                  : selectionLabel
                  ? selectionLabel === "Fecha de salida" ? "Salida del viaje" : selectionLabel.replace(/^Fecha de /, "")
                  : range
                    ? isStart ? "Salida" : isEnd ? "Fin" : ""
                    : "";
                const accessibleMarker = localized && language === "en"
                  ? marker === "recogida" || marker === "Regreso" ? "return pickup" : marker === "Salida" || marker === "Salida del viaje" ? "departure" : marker === "Fin" ? "last day" : "selected"
                  : marker || "seleccionada";
                const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(
                  localized && language === "en" ? "en-US" : "es-EC",
                  { weekday: "long", day: "numeric", month: "long", year: "numeric" }
                );
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={!libre}
                    onClick={() => clickDia(date)}
                    aria-label={`${dateLabel}${selected ? `, ${accessibleMarker}` : ""}${reservado ? localized && language === "en" ? ", unavailable" : ", no disponible" : ""}`}
                    aria-pressed={selected}
                    title={reservado ? "No disponible" : dateLabel}
                    className={`flex h-12 min-w-0 flex-col items-center justify-center rounded-xl border text-xs font-bold transition-colors sm:h-14 ${
                      isSecondary ? "border-emerald-600 bg-emerald-600 text-white shadow-sm" :
                      selected ? "border-[#E31E24] bg-[#E31E24] text-white shadow-sm" :
                      inRange ? "border-red-100 bg-red-50 text-red-800" :
                      reservado ? "cursor-not-allowed border-red-100 bg-red-50 text-red-400 line-through" :
                      past ? "cursor-not-allowed border-transparent bg-slate-50 text-slate-300" :
                      beforeMinDate ? "cursor-not-allowed border-transparent bg-slate-100 text-slate-400" :
                      `border-transparent bg-slate-50 text-slate-800 hover:border-emerald-200 hover:bg-emerald-50 ${today ? "ring-1 ring-inset ring-[#E31E24]" : ""}`
                    }`}
                  >
                    <span>{dayNum}</span>
                    {marker && selected && <span className="max-w-full truncate px-0.5 text-[8px] font-black leading-3">{marker}</span>}
                    {!selected && today && <span className="text-[8px] font-bold leading-3 text-[#E31E24]">Hoy</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-[10px] font-semibold text-slate-600">
              {vehiculoId && !allowUnassigned && <>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-100" /> Libre</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-red-100" /> Reservado</span>
              </>}
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#E31E24]" /> Tu elección</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-slate-200 bg-slate-50" /> Días pasados</span>
              {minDate > hoy && <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-100" /> Antes de fecha permitida</span>}
            </div>
          </>
        )}
      </div>
    </LocalizedContent>
  );
}
