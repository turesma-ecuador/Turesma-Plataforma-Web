"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { getAuthHeaders, handleUnauthorized } from "../../../lib/session";
import { useConductorPanel } from "../_components/use-conductor-panel";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Block = {
  id: number;
  fecha_inicio: string;
  fecha_fin: string;
  hora_inicio?: string | null;
  hora_fin?: string | null;
  motivo: "viaje_externo" | "ocupado" | "fuera_de_servicio";
  cliente_empresa?: string | null;
  origen?: string | null;
  destino?: string | null;
};

const reasonLabels: Record<Block["motivo"], string> = {
  viaje_externo: "Viaje externo",
  ocupado: "Ocupado con otro cliente",
  fuera_de_servicio: "Fuera de servicio",
};

export default function DisponibilidadPage() {
  const { checkingSession, user } = useConductorPanel();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (checkingSession || !user?.id) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${API}/api/conductor/${user.id}/disponibilidad-externa`, {
          headers: getAuthHeaders(),
        });
        if (handleUnauthorized(response.status)) return;
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo cargar la disponibilidad");
        if (active) setBlocks(Array.isArray(data) ? data : []);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudo cargar la disponibilidad");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [checkingSession, user?.id]);

  if (checkingSession) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" /></div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#E31E24]">Agenda del vehículo</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">Mi disponibilidad</h1>
        <p className="mt-2 text-sm font-medium text-slate-500">
          Consulta los compromisos registrados por Administración. Si surge un viaje externo o no puedes trabajar,
          comunícate con Administración para que revise y actualice la agenda.
        </p>
      </header>

      <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-800">
        Para evitar registros duplicados, los cambios de disponibilidad los gestiona Administración. Informa cualquier
        novedad por llamada o WhatsApp.
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-black text-slate-900"><CalendarClock size={20} />Compromisos registrados</h2>
        {loading ? <Loader2 className="animate-spin text-[#E31E24]" /> : blocks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm font-semibold text-slate-500">
            No hay compromisos externos registrados.
          </p>
        ) : blocks.map((block) => (
          <article key={block.id} className="rounded-xl border border-violet-200 bg-violet-50 p-4">
            <p className="font-black text-violet-900">
              {reasonLabels[block.motivo] || "Compromiso"} · {block.fecha_inicio}
              {block.fecha_fin !== block.fecha_inicio ? ` al ${block.fecha_fin}` : ""}
            </p>
            <p className="text-xs font-semibold text-violet-700">
              {block.hora_inicio ? `${block.hora_inicio.slice(0, 5)} - ${block.hora_fin?.slice(0, 5) || ""}` : "Todo el día"}
              {block.cliente_empresa ? ` · ${block.cliente_empresa}` : ""}
            </p>
            {(block.origen || block.destino) && (
              <p className="text-xs text-violet-700">{[block.origen, block.destino].filter(Boolean).join(" → ")}</p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
