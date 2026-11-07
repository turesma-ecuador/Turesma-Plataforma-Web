"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import {
  ShieldCheck, Loader2, CheckCircle2, XCircle, X, ImageIcon, Phone, Mail, IdCard,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Verificacion = {
  id: number; nombre: string; email: string; telefono: string | null;
  cedula: string | null; cedula_url: string | null; selfie_cedula_url: string | null;
  estado_verificacion: string; notas_verificacion: string | null; fecha_verificacion: string | null;
};

const ESTADO_BADGE: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
  verificado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rechazado: "bg-red-100 text-red-500 border-red-200",
  no_verificado: "bg-slate-100 text-slate-500 border-slate-200",
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente", verificado: "Verificado", rechazado: "Rechazado", no_verificado: "Sin verificar",
};

const VerificationImage = ({ src, alt, className }: { src: string; alt: string; className: string }) => {
  const [loadedImage, setLoadedImage] = useState<{ url: string; objectUrl: string } | null>(null);
  const [failedUrl, setFailedUrl] = useState("");
  const isPrivateFile = src.includes("/api/private-files/");

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    if (!isPrivateFile) {
      return () => {};
    }

    const headers = getAuthHeaders();
    delete headers["Content-Type"];
    fetch(src, { headers })
      .then(async (response) => {
        if (!response.ok) throw new Error("No se pudo cargar el documento");
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoadedImage({ url: src, objectUrl });
      })
      .catch(() => {
        if (!cancelled) setFailedUrl(src);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isPrivateFile, src]);

  const imageSrc = isPrivateFile
    ? loadedImage?.url === src ? loadedImage.objectUrl : ""
    : src;
  if (!imageSrc) {
    return (
      <div className={`${className} flex items-center justify-center bg-slate-100 text-xs text-slate-500`}>
        {failedUrl === src ? "No se pudo cargar" : "Cargando..."}
      </div>
    );
  }
  return <Image src={imageSrc} alt={alt} width={1200} height={900} unoptimized className={className} />;
};

export default function AdminVerificacionesPage() {
  const { checkingSession } = useAdminGuard();
  const [items, setItems] = useState<Verificacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("pendiente");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [rechazarId, setRechazarId] = useState<number | null>(null);
  const [notaRechazo, setNotaRechazo] = useState("");
  const [actingId, setActingId] = useState<number | null>(null);
  const [zoomImg, setZoomImg] = useState<string | null>(null);

  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/verificaciones?estado=${filtro}`, { headers: getAuthHeaders() });
      if (res.ok) setItems(await res.json());
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession) load(); }, [checkingSession, filtro]);
  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  const aprobar = async (id: number) => {
    setActingId(id); setErr(""); setMsg("");
    try {
      const res = await fetch(`${API}/api/admin/verificaciones/${id}/aprobar`, { method: "PATCH", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo aprobar");
      setMsg("Identidad verificada correctamente");
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setActingId(null); }
  };

  const rechazar = async () => {
    if (!rechazarId) return;
    setActingId(rechazarId); setErr(""); setMsg("");
    try {
      const res = await fetch(`${API}/api/admin/verificaciones/${rechazarId}/rechazar`, {
        method: "PATCH", headers: getAuthHeaders(), body: JSON.stringify({ notas: notaRechazo || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo rechazar");
      setMsg("Verificación rechazada");
      setRechazarId(null); setNotaRechazo("");
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setActingId(null); }
  };

  const pendientes = items.filter(v => v.estado_verificacion === "pendiente").length;

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={36} /></div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-xl">{msg}</div>}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl">{err}</div>}

      {/* FILTROS */}
      <div className="flex gap-2 flex-wrap bg-white p-3 sm:p-4 rounded-2xl border border-gray-100 shadow-sm">
        {["pendiente", "verificado", "rechazado", "todos"].map(e => (
          <button key={e} onClick={() => setFiltro(e)} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filtro === e ? "bg-emerald-500 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
            {ESTADO_LABEL[e] || e}{e === "pendiente" && pendientes > 0 ? ` (${pendientes})` : ""}
          </button>
        ))}
      </div>

      {/* LISTA */}
      {loading ? (
        <div className="flex items-center justify-center h-56"><Loader2 className="animate-spin text-emerald-500" size={36} /></div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm">
          <ShieldCheck size={42} className="text-slate-200 mx-auto mb-3" />
          <p className="font-black text-slate-300 uppercase italic text-sm">Sin verificaciones {filtro !== "todos" ? `en estado "${ESTADO_LABEL[filtro] || filtro}"` : ""}</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {items.map(v => (
            <div key={v.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-800 truncate">{v.nombre}</p>
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 truncate"><Mail size={11} />{v.email}</p>
                </div>
                <span className={`flex-shrink-0 text-[9px] font-black uppercase px-2.5 py-1 rounded-full border ${ESTADO_BADGE[v.estado_verificacion] || ESTADO_BADGE.no_verificado}`}>{ESTADO_LABEL[v.estado_verificacion] || v.estado_verificacion}</span>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5"><IdCard size={13} className="text-slate-400" /> {v.cedula || "—"}</span>
                {v.telefono && <span className="flex items-center gap-1.5"><Phone size={13} className="text-slate-400" /> {v.telefono}</span>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[{ url: v.cedula_url, label: "Cédula" }, { url: v.selfie_cedula_url, label: "Selfie con cédula" }].map(doc => doc.url ? (
                  <button key={doc.label} onClick={() => setZoomImg(doc.url)} className="block">
                    <VerificationImage src={doc.url} alt={doc.label} className="w-full h-32 object-cover rounded-xl border border-slate-200 hover:opacity-80 transition-all" />
                    <span className="text-[10px] text-slate-500">{doc.label}</span>
                  </button>
                ) : <div key={doc.label} className="h-32 flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-slate-200 text-[10px] text-slate-400"><ImageIcon size={24} />{doc.label} faltante</div>)}
              </div>

              {v.estado_verificacion === "rechazado" && v.notas_verificacion && (
                <p className="text-[10px] text-red-500 bg-red-50 rounded-lg p-2">Motivo: {v.notas_verificacion}</p>
              )}

              {v.estado_verificacion === "pendiente" && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => aprobar(v.id)} disabled={actingId === v.id || !v.cedula_url || !v.selfie_cedula_url}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60">
                    {actingId === v.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Verificar
                  </button>
                  <button onClick={() => { setRechazarId(v.id); setNotaRechazo(""); }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-black uppercase tracking-widest transition-all">
                    <XCircle size={13} /> Rechazar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* MODAL RECHAZAR */}
      {rechazarId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0f1a]/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-[2rem] bg-white shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="bg-red-500 p-5 text-white flex items-center justify-between">
              <h2 className="text-base font-black italic tracking-tighter uppercase">Rechazar verificación</h2>
              <button onClick={() => setRechazarId(null)} className="p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400">Motivo (se lo enviamos al cliente)</label>
                <textarea value={notaRechazo} onChange={e => setNotaRechazo(e.target.value)} rows={3}
                  className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white resize-none"
                  placeholder="Ej: La foto de la cédula no es legible" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setRechazarId(null)} className="flex-1 py-3 rounded-2xl border-2 border-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest">Cancelar</button>
                <button onClick={rechazar} disabled={actingId === rechazarId} className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-black text-xs uppercase tracking-widest hover:bg-red-600 transition-all disabled:opacity-60">
                  {actingId === rechazarId ? "Rechazando..." : "Confirmar rechazo"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ZOOM DE IMAGEN */}
      {zoomImg && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4" onClick={() => setZoomImg(null)}>
          <button onClick={() => setZoomImg(null)} className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full"><X size={28} /></button>
          <VerificationImage src={zoomImg} alt="Documento de identidad" className="max-w-full max-h-full rounded-2xl" />
        </div>
      )}
    </div>
  );
}
