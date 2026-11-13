"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  Bus, ArrowRight, DollarSign, Loader2,
  Star, CheckCircle2, MapPin, Navigation, CreditCard, X,
  Building2, UploadCloud, Clock, AlertTriangle, ImageIcon, FileDown,
} from "lucide-react";
import { getAuthHeaders, getStoredToken, handleUnauthorized } from "../../../lib/session";
import { useClienteGuard } from "../../../lib/use-cliente-guard";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { WhatsAppButton } from "../../../components/whatsapp-button";
import { descargarArchivo } from "../../../lib/download";
import { formatLocalizedDate, LocalizedContent, useLocale } from "../../../lib/i18n";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const LiveTripMap = dynamic(
  () => import("../../../components/live-trip-map").then((module) => module.LiveTripMap),
  { loading: () => <div className="h-64 animate-pulse rounded-2xl bg-slate-100" /> },
);

// Cuenta bancaria de la empresa para pagos por transferencia. Cámbiala aquí
// por los datos reales — se muestra tal cual al cliente en el modal de pago.
const CUENTA_EMPRESA = {
  banco: "Banco Pichincha",
  tipo: "Cuenta Corriente",
  numero: "2100123456",
  titular: "Turesma S.A.",
  ruc: "1391763581001",
};

type Reembolso = {
  id: number;
  monto: number;
  motivo: string;
  estado: "pendiente" | "completado";
  referencia_externa?: string | null;
  creado_en: string;
  completado_en?: string | null;
};

type Reserva = {
  id: number; estado: string; fecha_reserva: string; fecha_fin?: string | null;
  fecha_regreso?: string | null; hora_regreso?: string | null;
  origen?: string | null; destino?: string | null; num_personas: number; total: number;
  vehiculo_placa?: string | null; vehiculo_modelo?: string | null;
  vehiculo_imagen_url?: string | null;
  conductor_nombre?: string | null; conductor_telefono?: string | null;
  operaciones?: {
    id: number;
    grupo_numero?: number | null;
    unidad_numero?: number | null;
    fecha_programada: string;
    fecha_fin_programada?: string | null;
    origen: string;
    destino: string;
    estado: string;
    vehiculo_placa?: string | null;
    vehiculo_modelo?: string | null;
    vehiculo_imagen_url?: string | null;
    conductor_nombre?: string | null;
    conductor_telefono?: string | null;
  }[];
  reembolsos?: Reembolso[];
  calificacion?: number | null; comentario_calificacion?: string | null;
  monto_pagado?: number | null; estado_pago?: string | null;
  hora_salida?: string | null;
  cambio_destino?: {
    id: number;
    estado: string;
    origen_solicitado: string;
    destino_solicitado: string;
    total_anterior: number;
    total_propuesto: number | null;
    nota_admin: string | null;
  } | null;
};

type Pago = {
  id: number; monto: number; metodo: string; comprobante_url: string | null;
  estado: string; notas_admin: string | null; creado_en: string; revisado_en: string | null;
};

const ESTADO: Record<string, { label: string; cls: string }> = {
  confirmada: { label: "Confirmada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  en_curso: { label: "En curso", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  finalizada: { label: "Finalizada", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  pendiente: { label: "Pendiente", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  pendiente_pago: { label: "Pendiente de pago", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  cancelada: { label: "Cancelada", cls: "bg-red-50 text-red-600 border-red-200" },
};

const ESTADO_PAGO_STYLE: Record<string, { label: string; cls: string; icon: React.ComponentType<{ size?: number }> }> = {
  pendiente: { label: "Pago pendiente", cls: "bg-red-50 text-red-600 border-red-200", icon: AlertTriangle },
  parcial: { label: "Pago parcial", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock },
  confirmado: { label: "Pago confirmado", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  pagado: { label: "Pagado completo", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  reembolsado: { label: "Devuelto", cls: "bg-violet-50 text-violet-700 border-violet-200", icon: CheckCircle2 },
};

const ESTADO_COMPROBANTE_BADGE: Record<string, string> = {
  pendiente: "bg-amber-50 text-amber-700 border-amber-200",
  aprobado: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rechazado: "bg-red-50 text-red-600 border-red-200",
};

function StarRating({ value, onChange, readOnly }: { value: number; onChange?: (n: number) => void; readOnly?: boolean }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" disabled={readOnly}
          onMouseEnter={() => !readOnly && setHover(n)} onMouseLeave={() => !readOnly && setHover(0)}
          onClick={() => onChange?.(n)} className={readOnly ? "cursor-default" : "cursor-pointer"}>
          <Star size={22} className={(hover || value) >= n ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
        </button>
      ))}
    </div>
  );
}

// Modal para que el cliente pague por transferencia o PayPhone.
function PagoModal({ reserva, onClose, onSuccess }: { reserva: Reserva; onClose: () => void; onSuccess: () => void }) {
  const total = Number(reserva.total) || 0;
  const pagado = Number(reserva.monto_pagado) || 0;
  const saldoPendiente = Math.max(0, total - pagado);

  const [pagos, setPagos] = useState<Pago[]>([]);
  const [loadingPagos, setLoadingPagos] = useState(true);
  const [metodo, setMetodo] = useState<"transferencia" | "payphone">("transferencia");
  const [monto, setMonto] = useState(saldoPendiente.toFixed(2));
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const loadPagos = async () => {
    setLoadingPagos(true);
    try {
      const res = await fetch(`${API}/api/usuarios/mis-reservas/${reserva.id}/pagos`, { headers: getAuthHeaders() });
      if (handleUnauthorized(res.status)) return;
      if (res.ok) setPagos(await res.json());
    } catch { /* silencio */ }
    finally { setLoadingPagos(false); }
  };

  const downloadReceipt = async (pagoId: number) => {
    setDownloadingReceiptId(pagoId);
    setErr("");
    const result = await descargarArchivo(
      `/api/usuarios/mis-reservas/${reserva.id}/pagos/${pagoId}/recibo`,
      `recibo_pago_${pagoId}.pdf`
    );
    if (!result.ok) setErr(result.error || "No se pudo descargar el recibo");
    setDownloadingReceiptId(null);
  };

  useEffect(() => { loadPagos();   }, []);

  const handleSubmit = async () => {
    setErr(""); setMsg("");
    if (!monto || Number(monto) <= 0) { setErr("Ingresa un monto válido"); return; }
    if (metodo === "payphone" && Number(monto) < 1) {
      setErr("El monto mínimo para pagar con PayPhone es $1.00");
      return;
    }

    if (metodo === "payphone") {
      setSending(true);
      try {
        const res = await fetch(`${API}/api/usuarios/mis-reservas/${reserva.id}/pagos/payphone`, {
          method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ monto: Number(monto) }),
        });
        const raw = await res.text();
        let data: { error?: string; payment_url?: string } = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error("El servidor no devolvió una respuesta válida de PayPhone. Reinicia el backend e inténtalo nuevamente.");
        }
        if (!res.ok) throw new Error(data.error || "No se pudo iniciar el pago PayPhone");
        if (!data.payment_url) throw new Error("PayPhone no devolvió un enlace de pago. Verifica las credenciales y el Store ID.");
        window.location.assign(data.payment_url);
      } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); setSending(false); }
      return;
    }

    if (!file) { setErr("Adjunta una imagen del comprobante"); return; }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("comprobante", file);
      // Sin "Content-Type": el navegador debe fijar el boundary multipart él mismo.
      const upRes = await fetch(`${API}/api/usuarios/uploads/comprobante-pago`, {
        method: "POST", headers: { Authorization: `Bearer ${getStoredToken() || ""}` }, body: fd,
      });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(upData.error || "No se pudo subir el comprobante");
      setUploading(false);

      setSending(true);
      const res = await fetch(`${API}/api/usuarios/mis-reservas/${reserva.id}/pagos`, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({ monto: Number(monto), metodo, comprobante_url: upData.imageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo enviar el pago");
      setMsg("Comprobante enviado. El administrador lo revisará pronto.");
      setFile(null);
      loadPagos();
      onSuccess();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setUploading(false); setSending(false); }
  };

  return (
    <LocalizedContent>
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0f1a]/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-[2rem] bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 my-4">
        <div className="bg-[#0b0f1a] p-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-[#E31E24] p-2 rounded-xl"><CreditCard size={18} /></div>
            <div>
              <h2 className="text-base font-black italic tracking-tighter uppercase">Pagar reserva #{reserva.id}</h2>
              <p className="text-[10px] text-gray-400">Debes pagar el total para confirmar tu viaje</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* RESUMEN */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-50 rounded-xl p-3"><p className="text-[9px] font-black uppercase text-slate-400">Total</p><p className="font-black text-slate-800">${total.toFixed(2)}</p></div>
            <div className="bg-slate-50 rounded-xl p-3"><p className="text-[9px] font-black uppercase text-slate-400">Saldo pendiente</p><p className="font-black text-slate-800">${saldoPendiente.toFixed(2)}</p></div>
            <div className="bg-emerald-50 rounded-xl p-3"><p className="text-[9px] font-black uppercase text-emerald-500">Pagado</p><p className="font-black text-emerald-700">${pagado.toFixed(2)}</p></div>
          </div>

          {msg && <div className="p-3 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-xs font-bold rounded-r-xl">{msg}</div>}

          {/* MÉTODO DE PAGO */}
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase text-slate-400">¿Cómo vas a pagar?</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMetodo("transferencia")}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border-2 transition-all ${metodo === "transferencia" ? "bg-[#E31E24] border-[#E31E24] text-white" : "border-slate-100 text-slate-500"}`}>
                <Building2 size={14} /> Transferencia
              </button>
              <button type="button" onClick={() => setMetodo("payphone")}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest border-2 transition-all ${metodo === "payphone" ? "bg-[#00a99d] border-[#00a99d] text-white" : "border-slate-100 text-slate-500"}`}>
                <CreditCard size={14} /> PayPhone / Tarjeta
              </button>
            </div>
          </div>

          {metodo === "payphone" ? (
            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-center space-y-2">
              <p className="text-xs font-black text-teal-800">Pago seguro con PayPhone</p>
              <p className="text-[11px] text-teal-700">Serás enviado al formulario seguro de PayPhone para pagar con tarjeta. Turesma no guarda datos de tu tarjeta.</p>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1.5 text-xs">
              <p className="font-black text-slate-700 uppercase text-[11px] mb-1">Datos para transferencia</p>
              <p><span className="text-slate-400">Banco:</span> <span className="font-bold text-slate-700">{CUENTA_EMPRESA.banco}</span></p>
              <p><span className="text-slate-400">{CUENTA_EMPRESA.tipo}:</span> <span className="font-bold text-slate-700">{CUENTA_EMPRESA.numero}</span></p>
              <p><span className="text-slate-400">Titular:</span> <span className="font-bold text-slate-700">{CUENTA_EMPRESA.titular}</span></p>
              <p><span className="text-slate-400">RUC:</span> <span className="font-bold text-slate-700">{CUENTA_EMPRESA.ruc}</span></p>
            </div>
          )}

          {/* MONTO + COMPROBANTE */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400">Monto que estás pagando ($) *</label>
              <input type="number" min={metodo === "payphone" ? "1.00" : "0.01"} step="0.01" value={monto} onChange={e => setMonto(e.target.value)}
                className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-[#E31E24] focus:bg-white" />
            </div>
            {metodo !== "payphone" && <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400">Comprobante (imagen) *</label>
              <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-xl py-4 cursor-pointer hover:border-[#E31E24] transition-all">
                <UploadCloud size={16} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-500">{file ? <span data-no-translate>{file.name}</span> : "Selecciona una imagen"}</span>
                <input type="file" accept="image/*" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              </label>
            </div>}
            {err && <p className="text-red-600 text-xs font-bold">{err}</p>}
            <button onClick={handleSubmit} disabled={uploading || sending}
              className="w-full py-3 rounded-2xl bg-[#E31E24] text-white font-black text-xs uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-2 disabled:opacity-60">
              {(uploading || sending) ? <Loader2 size={16} className="animate-spin" /> : metodo === "payphone" ? <CreditCard size={16} /> : <UploadCloud size={16} />}
              {uploading ? "Subiendo imagen..." : sending ? "Enviando..." : metodo === "payphone" ? "Continuar con PayPhone" : "Enviar comprobante"}
            </button>
          </div>

          {/* HISTORIAL DE COMPROBANTES ENVIADOS */}
          {!loadingPagos && pagos.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <p className="text-[10px] font-black uppercase text-slate-400">Comprobantes enviados</p>
              {pagos.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 bg-slate-50 rounded-xl p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {p.comprobante_url ? (
                      <a href={p.comprobante_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                        <Image src={p.comprobante_url} alt="Comprobante de pago" width={36} height={36} sizes="36px" className="w-9 h-9 rounded-lg object-cover border border-slate-200" />
                      </a>
                    ) : <ImageIcon size={16} className="text-slate-300 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-700">${Number(p.monto).toFixed(2)}</p>
                      {p.estado === "rechazado" && p.notas_admin && <p data-no-translate className="text-[10px] text-red-500 truncate">{p.notas_admin}</p>}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {p.estado === "aprobado" && (
                      <button
                        type="button"
                        onClick={() => downloadReceipt(p.id)}
                        disabled={downloadingReceiptId === p.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2 py-1.5 text-[9px] font-black uppercase text-emerald-700 disabled:opacity-60"
                      >
                        {downloadingReceiptId === p.id
                          ? <Loader2 size={12} className="animate-spin" />
                          : <FileDown size={12} />}
                        Recibo
                      </button>
                    )}
                    <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${ESTADO_COMPROBANTE_BADGE[p.estado] || ESTADO_COMPROBANTE_BADGE.pendiente}`}>{p.estado}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </LocalizedContent>
  );
}

export default function ClienteHistorialPage() {
  const { language } = useLocale();
  const { user, checkingSession } = useClienteGuard();
  const userId = user?.id;
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);
  const [rateId, setRateId] = useState<number | null>(null);
  const [stars, setStars] = useState(5);
  const [comentario, setComentario] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [trackId, setTrackId] = useState<number | null>(null);
  const [pagoReserva, setPagoReserva] = useState<Reserva | null>(null);
  const [downloadingOrderId, setDownloadingOrderId] = useState<number | null>(null);
  const [downloadingProformaId, setDownloadingProformaId] = useState<number | null>(null);
  const [fileError, setFileError] = useState("");
  const [cambioDestinoReserva, setCambioDestinoReserva] = useState<Reserva | null>(null);
  const [cambioOrigen, setCambioOrigen] = useState("");
  const [cambioDestino, setCambioDestino] = useState("");
  const [cambioDestinoError, setCambioDestinoError] = useState("");
  const [cambioDestinoSaving, setCambioDestinoSaving] = useState(false);

  // Reprogramar (cambiar fecha/hora de salida) de una reserva confirmada
  const [reprogReserva, setReprogReserva] = useState<Reserva | null>(null);
  const [reprogFecha, setReprogFecha] = useState("");
  const [reprogHora, setReprogHora] = useState("");
  const [reprogSaving, setReprogSaving] = useState(false);
  const [reprogMsg, setReprogMsg] = useState("");

  const abrirReprogramar = (r: Reserva) => {
    setReprogReserva(r);
    setReprogFecha(r.fecha_reserva ? String(r.fecha_reserva).slice(0, 10) : "");
    setReprogHora(r.hora_salida || "");
    setReprogMsg("");
  };

  const descargarOrdenCompra = async (reservaId: number) => {
    setDownloadingOrderId(reservaId);
    setFileError("");
    const result = await descargarArchivo(
      `/api/usuarios/mis-reservas/${reservaId}/orden-compra`,
      `orden_compra_reserva_${reservaId}.pdf`
    );
    if (!result.ok) setFileError(result.error || "La orden de compra todavía no está disponible");
    setDownloadingOrderId(null);
  };

  const descargarProforma = async (reservaId: number) => {
    setDownloadingProformaId(reservaId);
    setFileError("");
    const result = await descargarArchivo(
      `/api/usuarios/mis-reservas/${reservaId}/proforma`,
      `proforma_reserva_${reservaId}.pdf`
    );
    if (!result.ok) setFileError(result.error || "No se pudo descargar la proforma");
    setDownloadingProformaId(null);
  };

  const guardarReprogramacion = async () => {
    if (!reprogReserva) return;
    if (!reprogFecha) { setReprogMsg("Selecciona una fecha."); return; }
    setReprogSaving(true); setReprogMsg("");
    try {
      const res = await fetch(`${API}/api/usuarios/mis-reservas/${reprogReserva.id}/reprogramar`, {
        method: "PATCH", headers: getAuthHeaders(),
        body: JSON.stringify({ fecha: reprogFecha, hora: reprogHora }),
      });
      if (handleUnauthorized(res.status)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo cambiar la fecha/hora");
      setReprogReserva(null);
      setMsg(data.message || "Fecha/hora actualizada. Avisamos al administrador y al conductor.");
      load();
    } catch (e) { setReprogMsg(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setReprogSaving(false); }
  };

  const abrirSolicitudCambioDestino = (reserva: Reserva) => {
    setCambioDestinoReserva(reserva);
    setCambioOrigen(reserva.origen || "");
    setCambioDestino(reserva.destino || "");
    setCambioDestinoError("");
  };

  const enviarSolicitudCambioDestino = async () => {
    if (!cambioDestinoReserva) return;
    setCambioDestinoSaving(true);
    setCambioDestinoError("");
    try {
      const response = await fetch(`${API}/api/usuarios/mis-reservas/${cambioDestinoReserva.id}/cambio-destino`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ origen: cambioOrigen, destino: cambioDestino }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo enviar la solicitud");
      setCambioDestinoReserva(null);
      setMsg(data.message || "Solicitud enviada para revisión");
      await load(true);
    } catch (requestError) {
      setCambioDestinoError(requestError instanceof Error ? requestError.message : "No se pudo enviar la solicitud");
    } finally {
      setCambioDestinoSaving(false);
    }
  };

  const responderPropuestaCambioDestino = async (solicitudId: number, decision: "aceptar" | "rechazar") => {
    setSaving(true);
    setMsg("");
    try {
      const response = await fetch(`${API}/api/usuarios/mis-reservas/cambio-destino/${solicitudId}/${decision}`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo responder a la propuesta");
      setMsg(data.message || "Respuesta guardada");
      await load(true);
    } catch (responseError) {
      setFileError(responseError instanceof Error ? responseError.message : "No se pudo responder a la propuesta");
    } finally {
      setSaving(false);
    }
  };

  const load = async (silencioso = false) => {
    if (!userId) return;
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch(`${API}/api/usuarios/mis-reservas`, { headers: getAuthHeaders() });
      if (handleUnauthorized(res.status)) return;
      if (res.ok) {
        const data = await res.json();
        setReservas(Array.isArray(data) ? data : []);
      }
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (checkingSession || !userId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkingSession, userId]);

  useEffect(() => {
    if (checkingSession || !userId || !reservas.length || typeof window === "undefined") return;
    const reservaId = Number(new URLSearchParams(window.location.search).get("abrir_pago"));
    if (!Number.isInteger(reservaId) || reservaId <= 0) return;
    const reserva = reservas.find((item) => item.id === reservaId);
    if (!reserva) return;

    setPagoReserva(reserva);
    window.history.replaceState({}, "", "/cliente/historial");
  }, [checkingSession, userId, reservas]);

  useEffect(() => {
    if (checkingSession || !userId || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const payphoneResult = params.get("payphone");
    const paymentId = params.get("id");
    const clientTransactionId = params.get("clientTransactionId");
    const reservaId = params.get("reserva_id");
    if (payphoneResult !== "ok" || !paymentId || !clientTransactionId || !reservaId) return;
    const captureKey = `payphone-confirm-${paymentId}`;
    if (sessionStorage.getItem(captureKey)) return;
    sessionStorage.setItem(captureKey, "processing");
    fetch(`${API}/api/usuarios/mis-reservas/${reservaId}/pagos/payphone/confirmar`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ payment_id: paymentId, client_transaction_id: clientTransactionId }),
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "PayPhone no pudo confirmar el pago");
        setMsg(data.message || "Pago PayPhone confirmado correctamente");
        sessionStorage.setItem(captureKey, "done");
        load(true);
      })
      .catch(error => {
        sessionStorage.removeItem(captureKey);
        setMsg(error.message);
      })
      .finally(() => window.history.replaceState({}, "", "/cliente/historial"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkingSession, userId]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession && !!userId, immediate: false });

  const enviarCalificacion = async (reservaId: number) => {
    setSaving(true); setMsg("");
    try {
      const res = await fetch(`${API}/api/usuarios/mis-reservas/${reservaId}/calificar`, {
        method: "PATCH", headers: getAuthHeaders(),
        body: JSON.stringify({ calificacion: stars, comentario }),
      });
      if (handleUnauthorized(res.status)) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg(data.message || "¡Gracias por calificar!");
      setRateId(null); setComentario(""); setStars(5);
      load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setSaving(false); }
  };

  if (checkingSession || loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={34} /></div>;

  return (
    <LocalizedContent>
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black italic tracking-tighter uppercase text-slate-900">Historial de Viajes</h1>
      </div>

      {msg && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm text-emerald-700 font-bold flex items-center gap-2"><CheckCircle2 size={16} />{msg}</div>}
      {fileError && <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700 font-bold flex items-center gap-2"><AlertTriangle size={16} />{fileError}</div>}

      {reservas.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center shadow-sm">
          <Bus size={36} className="text-slate-200 mx-auto mb-3" />
          <p className="font-black text-slate-300 uppercase italic text-sm">Aún no tienes viajes</p>
          <p className="text-xs text-slate-400 mt-1">Tus reservas aparecerán aquí cuando una cotización sea aprobada.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reservas.map(r => {
            const est = ESTADO[r.estado] || ESTADO.pendiente;
            const pagoCompletoConfirmado = Number(r.total) <= 0 || r.estado_pago === "pagado";
            const viajeRealizado = r.estado === "finalizada" && pagoCompletoConfirmado;
            const puedeCalificar = viajeRealizado && !r.calificacion;
            const totalReserva = Number(r.total) || 0;
            const montoPagado = Math.min(totalReserva, Math.max(0, Number(r.monto_pagado) || 0));
            const saldoPendiente = Math.max(0, totalReserva - montoPagado);
            const pagoConfirmado = ["pagado", "confirmado"].includes(String(r.estado_pago || "").toLowerCase());
            const pagoCompleto = totalReserva > 0 && pagoConfirmado && saldoPendiente <= 0.01;
            const requierePago = totalReserva > 0 && !["cancelada"].includes(r.estado) && !pagoCompleto;
            const pagoStyle = r.estado_pago === "reembolsado"
              ? ESTADO_PAGO_STYLE.reembolsado
              : pagoCompleto
              ? ESTADO_PAGO_STYLE.pagado
              : montoPagado > 0
                ? ESTADO_PAGO_STYLE.parcial
                : ESTADO_PAGO_STYLE.pendiente;
            return (
              <div key={r.id} className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-800 min-w-0">
                    <MapPin size={15} className="text-[#E31E24] flex-shrink-0" />
                    <span data-no-translate className="truncate">{r.origen || "—"}</span>
                    <ArrowRight size={13} className="text-slate-400 flex-shrink-0" />
                    <span data-no-translate className="truncate">{r.destino || "—"}</span>
                  </div>
                  <span className={`flex-shrink-0 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border ${est.cls}`}>{est.label}</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="bg-slate-50 rounded-xl p-2.5"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Fecha</p><p className="font-bold text-slate-700">{formatLocalizedDate(r.fecha_reserva, language)}{r.fecha_fin && r.fecha_fin !== r.fecha_reserva ? ` → ${formatLocalizedDate(r.fecha_fin, language)}` : ""}{r.fecha_regreso ? ` · Regreso: ${formatLocalizedDate(r.fecha_regreso, language)}${r.hora_regreso ? ` ${r.hora_regreso}` : ""}` : ""}</p></div>
                  <div className="bg-slate-50 rounded-xl p-2.5"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Personas</p><p className="font-bold text-slate-700">{r.num_personas}</p></div>
                  <div className="bg-slate-50 rounded-xl p-2.5">
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Vehículo asignado</p>
                    <div className="mt-1.5 flex min-w-0 items-center gap-2">
                      {r.vehiculo_imagen_url ? (
                        <Image
                          src={r.vehiculo_imagen_url}
                          alt={`Vehículo asignado ${r.vehiculo_placa || ""}`}
                          width={52}
                          height={42}
                          sizes="52px"
                          className="h-10 w-12 shrink-0 rounded-lg border border-slate-200 object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-300">
                          <Bus size={20} aria-hidden="true" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-700">
                          {r.vehiculo_placa ? <span data-no-translate>{r.vehiculo_placa}</span> : "Por asignar"}
                        </p>
                        {r.vehiculo_modelo && <p className="truncate text-[10px] text-slate-500">{r.vehiculo_modelo}</p>}
                        {!r.vehiculo_imagen_url && r.vehiculo_placa && <p className="text-[9px] text-slate-400">Foto no disponible</p>}
                      </div>
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-2.5"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Conductor</p><p className="font-bold text-slate-700 truncate">{r.conductor_nombre ? <span data-no-translate>{r.conductor_nombre}</span> : "Por asignar"}</p></div>
                </div>

                {(r.operaciones || []).length > 0 && (
                  <div className="mt-3 space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-900">Seguimiento de unidades</p>
                    {r.operaciones?.map((operation) => (
                      <div key={operation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/80 p-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {operation.vehiculo_imagen_url ? (
                            <Image
                              src={operation.vehiculo_imagen_url}
                              alt={`Vehículo asignado ${operation.vehiculo_placa || ""}`}
                              width={52}
                              height={42}
                              sizes="52px"
                              className="h-10 w-12 shrink-0 rounded-lg border border-slate-200 object-cover"
                            />
                          ) : (
                            <span className="flex h-10 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-300">
                              <Bus size={20} aria-hidden="true" />
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-black text-blue-950">
                              Grupo {operation.grupo_numero} · Unidad {operation.unidad_numero} · {operation.estado.replaceAll("_", " ")}
                            </p>
                            <p data-no-translate className="truncate text-[10px] font-semibold text-slate-700">
                              {operation.origen} → {operation.destino}
                            </p>
                            <p className="text-[10px] text-slate-600">
                              {operation.vehiculo_placa || "Vehículo por asignar"}
                              {operation.vehiculo_modelo ? ` · ${operation.vehiculo_modelo}` : ""}
                              {operation.conductor_nombre ? ` · ${operation.conductor_nombre}` : ""}
                            </p>
                          </div>
                        </div>
                        {operation.conductor_telefono && (
                          <WhatsAppButton
                            telefono={operation.conductor_telefono}
                            title={`WhatsApp de ${operation.conductor_nombre || "conductor"}`}
                            mensaje={`Hola, soy el cliente de la reserva #${r.id}, grupo ${operation.grupo_numero} unidad ${operation.unidad_numero}.`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {r.cambio_destino && (
                  <div className="mt-3 space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-800">
                      Cambio de ruta · {r.cambio_destino.estado.replaceAll("_", " ")}
                    </p>
                    <p data-no-translate className="text-xs font-semibold text-blue-900">
                      {r.cambio_destino.origen_solicitado} → {r.cambio_destino.destino_solicitado}
                    </p>
                    {r.cambio_destino.estado === "propuesta_cliente" && r.cambio_destino.total_propuesto != null && (
                      <>
                        <p className="text-xs text-blue-900">
                          Total actual: ${Number(r.cambio_destino.total_anterior).toFixed(2)} · Propuesta: ${Number(r.cambio_destino.total_propuesto).toFixed(2)}
                        </p>
                        {r.cambio_destino.nota_admin && <p className="text-xs text-blue-800">{r.cambio_destino.nota_admin}</p>}
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => void responderPropuestaCambioDestino(r.cambio_destino!.id, "aceptar")} disabled={saving} className="rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50">Aceptar propuesta</button>
                          <button type="button" onClick={() => void responderPropuestaCambioDestino(r.cambio_destino!.id, "rechazar")} disabled={saving} className="rounded-lg bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-600 disabled:opacity-50">Rechazar propuesta</button>
                        </div>
                      </>
                    )}
                    {r.cambio_destino.estado === "pendiente_admin" && <p className="text-xs text-blue-800">Turesma revisará la nueva ruta y te enviará el total antes de aplicarla.</p>}
                    {r.cambio_destino.estado === "pago_pendiente" && <p className="text-xs text-blue-800">Paga el saldo pendiente de la reserva. Aplicaremos la nueva ruta después de confirmar el pago.</p>}
                    {r.cambio_destino.estado === "devolucion_pendiente" && <p className="text-xs text-blue-800">Aceptaste un precio menor. La ruta se actualizará después de registrar la devolución externa.</p>}
                    {r.cambio_destino.estado === "aplicada" && <p className="text-xs text-emerald-800">La nueva ruta ya está aplicada.</p>}
                    {r.cambio_destino.estado === "rechazada_admin" && <p className="text-xs text-slate-700">La solicitud fue rechazada. La reserva mantiene la ruta original. {r.cambio_destino.nota_admin}</p>}
                    {r.cambio_destino.estado === "rechazada_cliente" && <p className="text-xs text-slate-700">Rechazaste la propuesta. La reserva mantiene la ruta original.</p>}
                  </div>
                )}

                {(r.reembolsos || []).length > 0 && (
                  <div className="mt-3 space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-violet-900">Seguimiento de devoluciones</p>
                    {r.reembolsos?.map((refund) => (
                      <div key={refund.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-white/80 p-2.5">
                        <div>
                          <p className="text-xs font-black text-violet-900">${Number(refund.monto).toFixed(2)} · {refund.estado === "pendiente" ? "Pendiente de procesar" : "Completada"}</p>
                          <p className="mt-0.5 text-[10px] text-violet-800">{refund.motivo}</p>
                        </div>
                        {refund.estado === "pendiente" && (
                          <p className="text-[10px] font-semibold text-violet-800">El dinero aún no se ha transferido; te avisaremos cuando se procese.</p>
                        )}
                        {refund.estado === "completado" && refund.referencia_externa && (
                          <p className="text-[10px] text-violet-700">Referencia: {refund.referencia_externa}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                  {Number(r.total) > 0 && <div className="flex items-center gap-1 text-emerald-600"><DollarSign size={14} /><span className="text-base font-black">${Number(r.total).toFixed(2)}</span></div>}
                  {r.conductor_telefono && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                      <span className="text-[10px] font-bold text-emerald-900">¿Necesitas coordinar con {r.conductor_nombre || "el conductor"}?</span>
                      <WhatsAppButton
                        telefono={r.conductor_telefono}
                        variant="full"
                        title={`WhatsApp de ${r.conductor_nombre || "conductor"}`}
                        mensaje={`Hola, soy el cliente de la reserva #${r.id} de Turesma.`}
                      />
                    </div>
                  )}
                </div>

                {/* ESTADO DE PAGO / BOTÓN PARA PAGAR */}
                {Number(r.total) > 0 && r.estado_pago === "reembolsado" && (
                  <div className="mt-3 flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-violet-700">
                    <CheckCircle2 size={12} />
                    Devolución registrada por administración
                  </div>
                )}
                {Number(r.total) > 0 && !["cancelada"].includes(r.estado) && (
                  <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                    <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${pagoStyle.cls}`}>
                      <pagoStyle.icon size={12} />
                      {pagoCompleto ? "Pagado completo" : montoPagado > 0 ? `Abono: $${montoPagado.toFixed(2)} · Falta: $${saldoPendiente.toFixed(2)}` : pagoStyle.label}
                    </span>
                    {r.estado !== "cancelada" && (
                      <button
                        onClick={() => void descargarProforma(r.id)}
                        disabled={downloadingProformaId === r.id}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60"
                      >
                        {downloadingProformaId === r.id ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                        Ver proforma
                      </button>
                    )}
                    {requierePago && (
                      <button onClick={() => setPagoReserva(r)}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E31E24] hover:bg-black text-white text-[10px] font-black uppercase tracking-widest transition-all">
                        <CreditCard size={13} /> Pagar mi reserva
                      </button>
                    )}
                    {pagoCompleto && (
                      <button
                        onClick={() => descargarOrdenCompra(r.id)}
                        disabled={downloadingOrderId === r.id}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-60"
                      >
                        {downloadingOrderId === r.id ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
                        Descargar orden de compra
                      </button>
                    )}
                  </div>
                )}

                {r.estado === "finalizada" && !pagoCompletoConfirmado && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                    Este viaje no cuenta como realizado porque el pago total no está confirmado.
                  </div>
                )}

                {/* El mapa solo se habilita cuando el viaje realmente está en curso. */}
                {r.estado === "en_curso" && (
                  <div className="mt-3">
                    {trackId === r.id ? (
                      <div className="space-y-2">
                        <LiveTripMap reservaId={r.id} />
                        <button onClick={() => setTrackId(null)} className="w-full py-2 rounded-xl bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest">Ocultar mapa</button>
                      </div>
                    ) : (
                      <button onClick={() => setTrackId(r.id)}
                        className="w-full mt-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all bg-blue-600 text-white hover:bg-blue-700">
                        <Navigation size={14} /> Seguir mi viaje en vivo
                      </button>
                    )}
                  </div>
                )}

                {/* CAMBIAR FECHA/HORA (solo reservas confirmadas) */}
                {r.estado === "confirmada" && (
                  <>
                    <button onClick={() => abrirReprogramar(r)}
                      className="w-full mt-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
                      <Clock size={14} /> Cambiar fecha u hora de salida
                    </button>
                    {pagoCompleto && !["pendiente_admin", "propuesta_cliente", "pago_pendiente", "devolucion_pendiente"].includes(r.cambio_destino?.estado || "") && (
                      <button onClick={() => abrirSolicitudCambioDestino(r)}
                        className="w-full mt-2 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">
                        <MapPin size={14} /> Solicitar cambio de destino
                      </button>
                    )}
                  </>
                )}

                {/* Calificación */}
                {r.calificacion ? (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tu calificación:</span>
                    <StarRating value={r.calificacion} readOnly />
                    {r.comentario_calificacion && <span data-no-translate className="text-xs text-slate-500 italic">&quot;{r.comentario_calificacion}&quot;</span>}
                  </div>
                ) : puedeCalificar ? (
                  rateId === r.id ? (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Califica:</span>
                        <StarRating value={stars} onChange={setStars} />
                      </div>
                      <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={2} placeholder="Comentario (opcional)"
                        className="w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#E31E24] resize-none" />
                      <div className="flex gap-2">
                        <button onClick={() => setRateId(null)} className="px-4 py-2 rounded-xl border-2 border-slate-100 text-slate-500 text-xs font-black uppercase">Cancelar</button>
                        <button onClick={() => enviarCalificacion(r.id)} disabled={saving} className="px-4 py-2 rounded-xl bg-[#E31E24] text-white text-xs font-black uppercase flex items-center gap-2 disabled:opacity-60">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}Enviar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setRateId(r.id); setStars(5); setComentario(""); }}
                      className="mt-3 w-full py-2.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 text-xs font-black uppercase tracking-widest hover:bg-amber-100 transition-all flex items-center justify-center gap-2">
                      <Star size={14} />Calificar este viaje
                    </button>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {pagoReserva && (
        <PagoModal reserva={pagoReserva} onClose={() => setPagoReserva(null)} onSuccess={() => load(true)} />
      )}

      {cambioDestinoReserva && (
        <div className="fixed inset-0 z-[105] flex items-center justify-center overflow-y-auto bg-[#0b0f1a]/80 p-4 backdrop-blur-sm" onClick={() => !cambioDestinoSaving && setCambioDestinoReserva(null)}>
          <section className="my-4 w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div><p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Reserva #{cambioDestinoReserva.id}</p><h2 className="mt-1 text-xl font-black text-slate-900">Solicitar cambio de ruta</h2></div>
              <button type="button" onClick={() => setCambioDestinoReserva(null)} aria-label="Cerrar" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={20} /></button>
            </div>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              No modificaremos la reserva hasta que revises y aceptes la propuesta de precio. Si el nuevo trayecto cuesta más, deberás pagar la diferencia; si cuesta menos, administración ejecutará y registrará la devolución antes de aplicar el cambio.
            </p>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-500">Origen solicitado
              <input maxLength={500} value={cambioOrigen} onChange={(event) => setCambioOrigen(event.target.value)} className="mt-1 w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold normal-case outline-none focus:border-blue-400" />
            </label>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-500">Destino solicitado
              <input maxLength={500} value={cambioDestino} onChange={(event) => setCambioDestino(event.target.value)} className="mt-1 w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold normal-case outline-none focus:border-blue-400" />
            </label>
            {cambioDestinoError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-bold text-red-700">{cambioDestinoError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setCambioDestinoReserva(null)} disabled={cambioDestinoSaving} className="flex-1 rounded-xl border-2 border-slate-100 py-3 text-xs font-black uppercase text-slate-500">Cancelar</button>
              <button type="button" onClick={() => void enviarSolicitudCambioDestino()} disabled={cambioDestinoSaving || !cambioOrigen.trim() || !cambioDestino.trim()} className="flex-1 rounded-xl bg-blue-700 py-3 text-xs font-black uppercase text-white disabled:opacity-50">{cambioDestinoSaving ? "Enviando..." : "Enviar solicitud"}</button>
            </div>
          </section>
        </div>
      )}

      {/* MODAL: cambiar fecha/hora de una reserva confirmada */}
      {reprogReserva && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0f1a]/80 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={() => !reprogSaving && setReprogReserva(null)}>
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Clock size={18} className="text-amber-500" /> Cambiar fecha u hora
              </h3>
              <button onClick={() => !reprogSaving && setReprogReserva(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <p className="text-[12px] text-slate-500 mb-5">
              Reserva #{reprogReserva.id} · {reprogReserva.origen || "—"} → {reprogReserva.destino || "—"}.
              Se avisará por correo al cliente y se actualizará al administrador y al conductor.
            </p>

            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Nueva fecha de salida</label>
            <input type="date" value={reprogFecha} min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setReprogFecha(e.target.value)}
              className="w-full mb-4 px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 focus:outline-none focus:border-amber-400" />

            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Nueva hora de salida</label>
            <input type="time" value={reprogHora}
              onChange={(e) => setReprogHora(e.target.value)}
              className="w-full mb-2 px-4 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 focus:outline-none focus:border-amber-400" />
            <p className="text-[10px] text-slate-400 mb-4">Si dejas la hora vacía, se mantiene la hora actual.</p>

            {reprogMsg && <p className="text-[12px] font-semibold text-red-500 mb-3">{reprogMsg}</p>}

            <div className="flex gap-2">
              <button onClick={() => setReprogReserva(null)} disabled={reprogSaving}
                className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-500 text-[11px] font-black uppercase tracking-widest disabled:opacity-50">Cancelar</button>
              <button onClick={guardarReprogramacion} disabled={reprogSaving || !reprogFecha}
                className="flex-1 py-3 rounded-xl bg-[#E31E24] hover:bg-black text-white text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                {reprogSaving ? <><Loader2 size={14} className="animate-spin" /> Guardando…</> : <>Guardar cambio</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </LocalizedContent>
  );
}
