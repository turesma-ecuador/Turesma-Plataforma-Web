"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { descargarArchivo } from "../../../lib/download";
import { normalizeRole } from "../../../lib/session";
import {
  CreditCard, Loader2, CheckCircle2, XCircle,
  MapPin, ArrowRight, X, ImageIcon, FileDown,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Pago = {
  id: number; reserva_id: number; monto: number; metodo: string;
  comprobante_url: string | null; estado: string; notas_admin: string | null;
  creado_en: string; revisado_en: string | null;
  reserva_total: number; origen: string | null; destino: string | null; reserva_estado: string;
  reserva_monto_pagado: number; reserva_estado_pago: string;
  cliente_nombre: string; cliente_email: string;
  monto_reembolsado?: number;
  monto_reembolso_pendiente?: number;
  reembolsos?: Array<{ id: number; monto: number; motivo: string; referencia_externa: string | null; estado: string; creado_en: string; completado_en?: string | null; procesado_por: string }>;
};

const ESTADO_BADGE: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700 border-amber-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rechazado: "bg-red-100 text-red-500 border-red-200",
};

const METODO_LABEL: Record<string, string> = {
  transferencia: "Transferencia",
  link_pago: "Link de pago",
};

const INPUT = "w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white";

export default function AdminPagosPage() {
  const { user, checkingSession } = useAdminGuard();
  const router = useRouter();
  const isAdmin = normalizeRole(user?.rol) === "admin";
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("pendiente");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [rechazarId, setRechazarId] = useState<number | null>(null);
  const [notaRechazo, setNotaRechazo] = useState("");
  const [actingId, setActingId] = useState<number | null>(null);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<number | null>(null);
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [refundPayment, setRefundPayment] = useState<Pago | null>(null);
  const [refundForm, setRefundForm] = useState({ monto: "", motivo: "" });
  const [refundToComplete, setRefundToComplete] = useState<{ id: number; monto: number; reserva_id: number } | null>(null);
  const [completionReference, setCompletionReference] = useState("");
  const [focusedPaymentId, setFocusedPaymentId] = useState<number | null>(null);
  const [nextReservationId, setNextReservationId] = useState<number | null>(null);
  const [scrolledPaymentId, setScrolledPaymentId] = useState<number | null>(null);
  const [paymentLinkReady, setPaymentLinkReady] = useState(false);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    if (Number.isInteger(id) && id > 0) {
      setFocusedPaymentId(id);
      setFiltro("todos");
    }
    setPaymentLinkReady(true);
  }, []);

  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch(`${API}/api/admin/pagos?estado=${filtro}`, { headers: getAuthHeaders() });
      if (res.ok) setPagos(await res.json());
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession && paymentLinkReady) load(); }, [checkingSession, filtro, paymentLinkReady]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  useEffect(() => {
    if (!focusedPaymentId || loading || scrolledPaymentId === focusedPaymentId) return;
    const target = document.getElementById(`pago-${focusedPaymentId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setScrolledPaymentId(focusedPaymentId);
  }, [focusedPaymentId, loading, pagos, scrolledPaymentId]);

  const aprobar = async (id: number) => {
    setActingId(id); setErr(""); setMsg("");
    try {
      const res = await fetch(`${API}/api/admin/pagos/${id}/aprobar`, { method: "PATCH", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo aprobar");
      setMsg("Pago aprobado correctamente");
      const payment = pagos.find((item) => item.id === id);
      if (payment) setNextReservationId(payment.reserva_id);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setActingId(null); }
  };

  const downloadReceipt = async (pagoId: number) => {
    setDownloadingReceiptId(pagoId);
    setErr("");
    const result = await descargarArchivo(
      `/api/admin/pagos/${pagoId}/recibo`,
      `recibo_pago_${pagoId}.pdf`
    );
    if (!result.ok) setErr(result.error || "No se pudo descargar el recibo");
    setDownloadingReceiptId(null);
  };

  const rechazar = async () => {
    if (!rechazarId) return;
    setActingId(rechazarId); setErr(""); setMsg("");
    try {
      const res = await fetch(`${API}/api/admin/pagos/${rechazarId}/rechazar`, {
        method: "PATCH", headers: getAuthHeaders(), body: JSON.stringify({ notas: notaRechazo || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo rechazar");
      setMsg("Pago rechazado");
      setRechazarId(null); setNotaRechazo("");
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setActingId(null); }
  };

  const registrarPagoManual = async (pago: Pago) => {
    const saldo = Math.max(0, Number(pago.reserva_total) - Number(pago.reserva_monto_pagado || 0));
    if (saldo <= 0) return;
    if (!window.confirm(`¿Confirmar que la reserva #${pago.reserva_id} recibió el saldo restante de $${saldo.toFixed(2)}?`)) return;

    setActingId(pago.id); setErr(""); setMsg("");
    try {
      const res = await fetch(`${API}/api/admin/reservas/${pago.reserva_id}/pago-manual`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ monto: saldo, nota: "Saldo confirmado manualmente por el administrador" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo registrar el pago");
      setMsg(`La reserva #${pago.reserva_id} quedó pagada completamente`);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setActingId(null); }
  };

  const abrirReembolso = (pago: Pago) => {
    setRefundPayment(pago);
    setRefundForm({
      monto: Math.max(0, Number(pago.monto) - Number(pago.monto_reembolsado || 0) - Number(pago.monto_reembolso_pendiente || 0)).toFixed(2),
      motivo: "",
    });
    setErr("");
  };

  const registrarReembolso = async () => {
    if (!refundPayment) return;
    setActingId(refundPayment.id);
    setErr("");
    setMsg("");
    try {
      const response = await fetch(`${API}/api/admin/pagos/${refundPayment.id}/reembolso`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ...refundForm, monto: Number(refundForm.monto) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo registrar la devolución");
      setMsg(data.message || "Devolución registrada.");
      setRefundPayment(null);
      setRefundForm({ monto: "", motivo: "" });
      await load();
    } catch (refundError) {
      setErr(refundError instanceof Error ? refundError.message : "No se pudo registrar la devolución");
    } finally {
      setActingId(null);
    }
  };

  const completarReembolso = async () => {
    if (!refundToComplete) return;
    setActingId(refundToComplete.id);
    setErr("");
    setMsg("");
    try {
      const response = await fetch(`${API}/api/admin/reembolsos/${refundToComplete.id}/completar`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ referencia_externa: completionReference.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo completar la devolución");
      setMsg(data.message || "Devolución completada.");
      setRefundToComplete(null);
      setCompletionReference("");
      await load();
    } catch (refundError) {
      setErr(refundError instanceof Error ? refundError.message : "No se pudo completar la devolución");
    } finally {
      setActingId(null);
    }
  };

  const pendientes = pagos.filter(p => p.estado === "pendiente").length;

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={36} /></div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-xl">{msg}</div>}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl">{err}</div>}
      {nextReservationId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-800">Siguiente paso: revisar la reserva #{nextReservationId}.</p>
          <button type="button" onClick={() => router.push(`/admin/reservas?id=${nextReservationId}`)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-700">
            Continuar a reserva
          </button>
        </div>
      )}

      {/* FILTROS */}
      <div className="flex gap-2 flex-wrap bg-white p-3 sm:p-4 rounded-2xl border border-gray-100 shadow-sm">
        {["pendiente", "aprobado", "rechazado", "todos"].map(e => (
          <button key={e} onClick={() => setFiltro(e)} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filtro === e ? "bg-emerald-500 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
            {e}{e === "pendiente" && pendientes > 0 ? ` (${pendientes})` : ""}
          </button>
        ))}
      </div>

      {/* LISTA */}
      {loading ? (
        <div className="flex items-center justify-center h-56"><Loader2 className="animate-spin text-emerald-500" size={36} /></div>
      ) : pagos.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm">
          <CreditCard size={42} className="text-slate-200 mx-auto mb-3" />
          <p className="font-black text-slate-300 uppercase italic text-sm">Sin comprobantes {filtro !== "todos" ? `en estado "${filtro}"` : ""}</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {pagos.map(p => (
            <div key={p.id} id={`pago-${p.id}`} className={`bg-white rounded-2xl border shadow-sm p-4 space-y-3 ${focusedPaymentId === p.id ? "border-emerald-400 ring-2 ring-emerald-100" : "border-slate-200"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black text-slate-800">{p.cliente_nombre}</p>
                  <p className="text-[10px] text-slate-400 truncate">{p.cliente_email}</p>
                </div>
                <span className={`flex-shrink-0 text-[9px] font-black uppercase px-2.5 py-1 rounded-full border ${ESTADO_BADGE[p.estado] || ESTADO_BADGE.pendiente}`}>{p.estado}</span>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                <MapPin size={11} className="text-[#E31E24] flex-shrink-0" />
                <span className="truncate">{p.origen || "—"}</span>
                <ArrowRight size={10} className="text-slate-300 flex-shrink-0" />
                <span className="truncate">{p.destino || "—"}</span>
                <span className="text-slate-300 ml-1">#{p.reserva_id}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-[8px] font-black uppercase text-slate-400">Monto</p><p className="text-xs font-black text-slate-800">${Number(p.monto).toFixed(2)}</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-[8px] font-black uppercase text-slate-400">Método</p><p className="text-[10px] font-bold text-slate-600">{METODO_LABEL[p.metodo] || p.metodo}</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-[8px] font-black uppercase text-slate-400">Pagado / falta</p><p className="text-[10px] font-bold text-slate-600">${Number(p.reserva_monto_pagado).toFixed(2)} / ${Math.max(0, Number(p.reserva_total) - Number(p.reserva_monto_pagado)).toFixed(2)}</p></div>
              </div>
              <p className={`rounded-lg px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest ${
                Number(p.reserva_total) - Number(p.reserva_monto_pagado || 0) <= 0.01
                  ? "bg-emerald-50 text-emerald-700"
                  : Number(p.reserva_monto_pagado || 0) > 0
                    ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-600"
              }`}>
                {Number(p.reserva_total) - Number(p.reserva_monto_pagado || 0) <= 0.01
                  ? "Reserva pagada completamente"
                  : `Falta confirmar $${Math.max(0, Number(p.reserva_total) - Number(p.reserva_monto_pagado || 0)).toFixed(2)}`}
              </p>

              {Number(p.reserva_total) > Number(p.reserva_monto_pagado || 0) && p.estado !== "rechazado" && (
              <button onClick={() => registrarPagoManual(p)} disabled={actingId === p.id}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60">
                {actingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Marcar saldo pagado
              </button>
              )}

              {p.comprobante_url ? (
                <button onClick={() => setZoomImg(p.comprobante_url)} className="block w-full">
                  <Image src={p.comprobante_url} alt="Comprobante de pago" width={320} height={128} unoptimized className="w-full h-32 object-cover rounded-xl border border-slate-200 hover:opacity-80 transition-all" />
                </button>
              ) : (
                <div className="w-full h-32 flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200"><ImageIcon size={24} className="text-slate-300" /></div>
              )}

              {p.estado === "rechazado" && p.notas_admin && (
                <p className="text-[10px] text-red-500 bg-red-50 rounded-lg p-2">Motivo: {p.notas_admin}</p>
              )}

              {p.estado === "aprobado" && (
                <div className="space-y-2">
                <button type="button" onClick={() => router.push(`/admin/reservas?id=${p.reserva_id}`)} className="w-full rounded-xl bg-blue-50 py-2.5 text-[10px] font-black uppercase tracking-widest text-blue-700 transition-colors hover:bg-blue-100">
                  Continuar a reserva #{p.reserva_id}
                </button>
                <button
                  type="button"
                  onClick={() => downloadReceipt(p.id)}
                  disabled={downloadingReceiptId === p.id}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-50 py-2.5 text-[10px] font-black uppercase tracking-widest text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60"
                >
                  {downloadingReceiptId === p.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <FileDown size={14} />}
                  Descargar recibo de pago
                </button>
                {isAdmin && Number(p.monto) - Number(p.monto_reembolsado || 0) - Number(p.monto_reembolso_pendiente || 0) > 0.01 && (
                  <button type="button" onClick={() => abrirReembolso(p)} className="w-full rounded-xl bg-amber-50 py-2.5 text-[10px] font-black uppercase tracking-widest text-amber-800 hover:bg-amber-100">
                    Solicitar devolución manual
                  </button>
                )}
                {(p.reembolsos || []).length > 0 && (
                  <div className="space-y-1 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-900">Seguimiento de devoluciones</p>
                    {p.reembolsos?.map((refund) => (
                      <div key={refund.id} className="rounded-lg bg-white/80 p-2 text-[10px] leading-relaxed text-amber-950">
                        <p>
                          ${Number(refund.monto).toFixed(2)} · {refund.estado === "pendiente" ? "Pendiente de procesar" : "Completada"}
                          {refund.referencia_externa ? ` · Ref. ${refund.referencia_externa}` : ""}
                        </p>
                        <p>{refund.motivo}{refund.procesado_por ? ` · ${refund.procesado_por}` : ""}</p>
                        {refund.estado === "pendiente" && isAdmin && (
                          <button
                            type="button"
                            onClick={() => { setRefundToComplete({ id: refund.id, monto: Number(refund.monto), reserva_id: p.reserva_id }); setCompletionReference(""); }}
                            className="mt-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 font-black uppercase tracking-wide text-white"
                          >
                            Confirmar transferencia externa
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                </div>
              )}

              {p.estado === "pendiente" && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => aprobar(p.id)} disabled={actingId === p.id}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60">
                    {actingId === p.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Aprobar
                  </button>
                  <button onClick={() => { setRechazarId(p.id); setNotaRechazo(""); }}
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
              <h2 className="text-base font-black italic tracking-tighter uppercase">Rechazar pago</h2>
              <button onClick={() => setRechazarId(null)} className="p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-slate-400">Motivo (se lo enviamos al cliente)</label>
                <textarea value={notaRechazo} onChange={e => setNotaRechazo(e.target.value)} rows={3} className={INPUT + " resize-none"} placeholder="Ej: El comprobante no coincide con el monto reportado" />
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

      {refundPayment && isAdmin && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center bg-[#0b0f1a]/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-widest text-amber-700">Solo administración</p><h2 className="mt-1 text-xl font-black text-slate-950">Solicitar devolución</h2></div>
              <button type="button" onClick={() => setRefundPayment(null)} aria-label="Cerrar formulario de devolución" className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
            </div>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              Esta acción solo registra la devolución como pendiente; no transfiere dinero. Después de realizarla por el banco o procesador, confirma la transferencia y agrega su referencia.
            </p>
            <p className="text-sm font-bold text-slate-700">Pago #{refundPayment.id} · Reserva #{refundPayment.reserva_id} · Disponible: ${Math.max(0, Number(refundPayment.monto) - Number(refundPayment.monto_reembolsado || 0) - Number(refundPayment.monto_reembolso_pendiente || 0)).toFixed(2)}</p>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-500">Monto a devolver
              <input type="number" min="0.01" max={Math.max(0, Number(refundPayment.monto) - Number(refundPayment.monto_reembolsado || 0) - Number(refundPayment.monto_reembolso_pendiente || 0)).toFixed(2)} step="0.01" value={refundForm.monto} onChange={(event) => setRefundForm({ ...refundForm, monto: event.target.value })} className={`${INPUT} mt-1`} />
            </label>
            {Number(refundForm.monto) >= Number(refundPayment.reserva_monto_pagado || 0) - 0.01 && (
              <p className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">Si esta devolución deja en cero el saldo pagado de la reserva, primero debe estar cancelada.</p>
            )}
            <label className="block text-xs font-black uppercase tracking-wider text-slate-500">Motivo excepcional
              <textarea required minLength={5} maxLength={500} rows={3} value={refundForm.motivo} onChange={(event) => setRefundForm({ ...refundForm, motivo: event.target.value })} className={`${INPUT} mt-1 resize-none`} placeholder="Explica el motivo de la devolución" />
            </label>
            <div className="flex gap-3">
              <button type="button" onClick={() => setRefundPayment(null)} className="flex-1 rounded-xl border-2 border-slate-100 py-3 text-xs font-black uppercase tracking-widest text-slate-500">Cancelar</button>
              <button type="button" onClick={() => void registrarReembolso()} disabled={actingId === refundPayment.id || refundForm.motivo.trim().length < 5 || Number(refundForm.monto) <= 0} className="flex-1 rounded-xl bg-amber-600 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">{actingId === refundPayment.id ? "Guardando..." : "Registrar como pendiente"}</button>
            </div>
          </div>
        </div>
      )}

      {refundToComplete && isAdmin && (
        <div className="fixed inset-0 z-[106] flex items-center justify-center bg-[#0b0f1a]/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs font-black uppercase tracking-widest text-emerald-700">Confirmación administrativa</p><h2 className="mt-1 text-xl font-black text-slate-950">Marcar devolución como completada</h2></div>
              <button type="button" onClick={() => setRefundToComplete(null)} aria-label="Cerrar confirmación de devolución" className="rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
            </div>
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-900">
              Confirma solo después de haber transferido ${Number(refundToComplete.monto).toFixed(2)} fuera de Turesma. Se notificará al cliente.
            </p>
            <p className="text-sm font-bold text-slate-700">Reserva #{refundToComplete.reserva_id}</p>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-500">Referencia externa
              <input minLength={3} maxLength={120} value={completionReference} onChange={(event) => setCompletionReference(event.target.value)} className={`${INPUT} mt-1`} placeholder="Número de transacción o comprobante" />
            </label>
            <div className="flex gap-3">
              <button type="button" onClick={() => setRefundToComplete(null)} className="flex-1 rounded-xl border-2 border-slate-100 py-3 text-xs font-black uppercase tracking-widest text-slate-500">Cancelar</button>
              <button type="button" onClick={() => void completarReembolso()} disabled={actingId === refundToComplete.id || completionReference.trim().length < 3} className="flex-1 rounded-xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">{actingId === refundToComplete.id ? "Confirmando..." : "Confirmar transferencia"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ZOOM DE IMAGEN */}
      {zoomImg && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4" onClick={() => setZoomImg(null)}>
          <button onClick={() => setZoomImg(null)} className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full"><X size={28} /></button>
          <Image src={zoomImg} alt="Comprobante de pago" width={1200} height={900} unoptimized className="max-w-full max-h-full rounded-2xl" />
        </div>
      )}
    </div>
  );
}
