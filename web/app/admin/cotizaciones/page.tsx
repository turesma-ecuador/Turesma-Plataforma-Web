"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import { escapeReportHtml, openPrintableReport } from "../../../lib/print-report";
import { useAutoRefresh } from "../../../lib/use-auto-refresh";
import { WhatsAppButton } from "../../../components/whatsapp-button";
import { useConfirm } from "../../../components/confirm-dialog";
import {
  FileText, Check, X, Eye, Loader2,
  MapPin, Users, Calendar, DollarSign, Clock, Car,
  MessageSquare, TrendingUp, CheckCircle2, XCircle,
  Printer, Send, Download, RefreshCw
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Cotizacion = {
  id: number;
  usuario_id: number;
  cliente_nombre: string;
  cliente_email: string;
  cliente_telefono?: string | null;
  origen: string;
  destino: string;
  fecha_servicio: string;
  fecha_fin?: string | null;
  fecha_regreso?: string | null;
  hora_regreso?: string | null;
  num_personas: number;
  num_viajes?: number | null;
  distancia_km?: number | null;
  precio_desglose?: { daily_amount?: number; distance_amount?: number; trips_amount?: number; tolls_amount?: number; total?: number } | null;
  tipo_vehiculo?: string | null;
  notas?: string | null;
  estado: string;
  precio_final?: number | null;
  turno?: string | null;
  valor_ofrecido?: number | null;
  duracion_valor?: number | null;
  duracion_unidad?: string | null;
  hora_salida?: string | null;
  vehiculo_id?: number | null;
  vehiculo_placa?: string | null;
  vehiculo_modelo?: string | null;
  vehiculo_tipo_real?: string | null;
  vehiculo_conductor_id?: number | null;
  vehiculo_conductor_nombre?: string | null;
  respuesta_admin?: string | null;
  reserva_id?: number | null;
  creado_en: string;
};

type Resumen = {
  pendientes: number;
  aprobadas: number;
  rechazadas: number;
  total: number;
  ingresos_generados: number;
};

type RequerimientoPersonalizado = {
  id: number;
  usuario_id: number;
  cliente_nombre: string;
  cliente_email: string;
  cliente_telefono?: string | null;
  organizacion?: string | null;
  cantidad_vehiculos: number;
  tipo_vehiculo?: string | null;
  pasajeros_por_vehiculo?: number | null;
  service_groups?: Array<{
    cantidad_vehiculos: number;
    tipo_vehiculo?: string | null;
    pasajeros_por_vehiculo?: number | null;
    fecha_servicio?: string | null;
    fecha_fin?: string | null;
    hora_salida?: string | null;
    origen?: string | null;
    destino?: string | null;
    paradas?: string | null;
    detalles?: string | null;
    simultaneo?: boolean;
    precio_total?: number | null;
  }>;
  fecha_servicio?: string | null;
  fecha_fin?: string | null;
  hora_salida?: string | null;
  origen?: string | null;
  destino?: string | null;
  detalles: string;
  estado: string;
  precio_final?: number | null;
  reserva_id?: number | null;
  estado_despacho?: string | null;
  error_despacho?: string | null;
  respuesta_admin?: string | null;
  creado_en: string;
};

const ESTADO_BADGE: Record<string, string> = {
  pendiente:   "bg-amber-100 text-amber-700 border-amber-200",
  aprobada:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  rechazada:   "bg-red-100 text-red-500 border-red-200",
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: "Pendiente",
  negociacion: "Pendiente",
  aprobada:  "Aprobada",
  rechazada: "Rechazada",
};

type NegoItem = { actor: string; precio: number | null; mensaje: string | null; creado_en: string };
const INPUT_CLS = "w-full rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none transition-all focus:border-[#E31E24] focus:bg-white placeholder:font-normal";

function AdminCotizacionesContent() {
  const { checkingSession } = useAdminGuard();
  const confirmar = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pendingFocusId = useRef<number | null>(null);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [customRequests, setCustomRequests] = useState<RequerimientoPersonalizado[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<"cotizaciones" | "requerimientos">("cotizaciones");
  const [customResponses, setCustomResponses] = useState<Record<number, string>>({});
  const [customGroupPrices, setCustomGroupPrices] = useState<Record<number, string[]>>({});
  const [customServiceGroups, setCustomServiceGroups] = useState<Record<number, NonNullable<RequerimientoPersonalizado["service_groups"]>>>({});
  const [customStatuses, setCustomStatuses] = useState<Record<number, string>>({});
  const [savingCustomId, setSavingCustomId] = useState<number | null>(null);
  const [filtro, setFiltro] = useState("pendiente");
  const [selected, setSelected] = useState<Cotizacion | null>(null);
  const [modalMode, setModalMode] = useState<"view" | "aprobar" | "rechazar">("view");
  const [precioFinal, setPrecioFinal] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [nego, setNego] = useState<NegoItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const load = async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const [cotRes, resRes, customRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/cotizaciones?estado=${filtro}`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/api/admin/cotizaciones/resumen`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/api/admin/requerimientos-personalizados`, { headers: getAuthHeaders() }),
      ]);
      if (cotRes.ok) setCotizaciones(await cotRes.json());
      if (resRes.ok) setResumen(await resRes.json());
      if (customRes.ok) {
        const rows: RequerimientoPersonalizado[] = await customRes.json();
        setCustomRequests(rows);
        setCustomResponses(current => Object.fromEntries(rows.map(row => [row.id, current[row.id] ?? row.respuesta_admin ?? ""])));
        setCustomGroupPrices(current => Object.fromEntries(rows.map(row => [
          row.id,
          current[row.id] ?? (row.service_groups || []).map(group => group.precio_total == null ? "" : String(group.precio_total)),
        ])));
        setCustomServiceGroups(current => Object.fromEntries(rows.map(row => [
          row.id,
          current[row.id] ?? row.service_groups ?? [],
        ])));
        setCustomStatuses(current => Object.fromEntries(rows.map(row => [row.id, current[row.id] ?? row.estado])));
      }
    } catch { /* silencio */ }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession) load(); }, [checkingSession, filtro]);

  useAutoRefresh(() => load(true), { enabled: !checkingSession, immediate: false });

  // ── PROFORMA ────────────────────────────────────────────────────────────────
  const [proformaBusyId, setProformaBusyId] = useState<number | null>(null);

  const fetchProforma = async (cotId: number) => {
    const res = await fetch(`${API_URL}/api/admin/cotizaciones/${cotId}/proforma`, { headers: getAuthHeaders() });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "No se pudo generar la proforma");
    return j.data;
  };

  const fmtUSD = (n: number) => Number(n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtFechaProf = (f: any) => {
    if (!f) return "";
    const d = new Date(f);
    return Number.isNaN(d.getTime()) ? String(f) : `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
  };

  // Abre la proforma imprimible replicando el formato físico de la empresa.
  const verProforma = async (c: Cotizacion) => {
    setProformaBusyId(c.id); setErr("");
    try {
      const d = await fetchProforma(c.id);
      const e = d.empresa;
      const logoUrl = `${window.location.origin}/logo.png`;
      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Proforma ${escapeReportHtml(d.numero)} — Turesma</title>
        <style>
          *{margin:0;padding:0;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a}
          body{padding:40px;max-width:760px;margin:0 auto;font-size:12px}
          .head{display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:26px}
          .head .txt{order:2;width:100%;text-align:center}
          .head .txt p{margin:2px 0}
          .lema{font-weight:800;font-size:13px}
          .cursiva{font-style:italic;font-size:11.5px}
          .rucline{font-weight:800;font-size:12.5px;margin-top:5px}
          .mail{color:#2563eb;text-decoration:underline}
          .head img{order:1;height:72px;width:auto}
          .clirow{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}
          .cliname{font-weight:800;text-transform:uppercase;max-width:420px}
          .prof{font-weight:800;white-space:nowrap}
          .dato{margin:3px 0}
          table{width:100%;border-collapse:collapse;margin-top:14px}
          th{border:1px solid #1a1a1a;padding:8px;font-size:10.5px}
          td{border:1px solid #1a1a1a;padding:10px;vertical-align:top;font-size:11.5px}
          .desc-cell{height:250px}
          .num{text-align:right}
          .ctr{text-align:center}
          .total-lbl{font-weight:800;text-align:center}
          .total-val{font-weight:800;text-align:right}
          .noborder{border:none}
          .foot{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-top:34px}
          .foot p{margin:3px 0;font-size:11.5px}
          .banco b{font-weight:800}
          .firma{text-align:center;min-width:220px}
          .firma .linea{border-top:1px solid #1a1a1a;padding-top:6px;font-weight:800}
          .firma .cargo{font-weight:700}
          @media print{.noprint{display:none}body{padding:20px}}
        </style></head><body>
        <div class="head">
          <div class="txt">
            <p class="lema">${escapeReportHtml(e.lema)}</p>
            <p class="cursiva">${escapeReportHtml(e.sub1)}</p>
            <p class="cursiva">${escapeReportHtml(e.sub2)}</p>
            <p class="rucline">${escapeReportHtml(e.nombre)}&nbsp;&nbsp;RUC: ${escapeReportHtml(e.ruc)}</p>
            <p><b>Razón Social:</b> ${escapeReportHtml(e.razon)}</p>
            <p><b>Dirección:</b> ${escapeReportHtml(e.direccion)}</p>
            <p><b>Teléfono:</b> ${escapeReportHtml(e.telefonos)}</p>
            <p><b>Email:</b> <span class="mail">${escapeReportHtml(e.email)}</span></p>
          </div>
          <img class="report-logo" src="${logoUrl}" alt="Turesma" onerror="this.style.display='none'"/>
        </div>

        <div class="clirow">
          <p class="cliname">${escapeReportHtml(d.cliente.nombre || "")}</p>
          <p class="prof">PROFORMA. ${escapeReportHtml(d.numero)}</p>
        </div>
        <p class="dato"><b>${d.cliente.tipo_identificacion === "pasaporte" ? "PASAPORTE" : d.cliente.tipo_identificacion === "ruc" || (!d.cliente.tipo_identificacion && String(d.cliente.cedula || "").length === 13) ? "RUC" : "CÉDULA"}:</b>&nbsp;&nbsp;${escapeReportHtml(d.cliente.cedula || "—")}</p>
        <p class="dato"><b>FECHA:</b>&nbsp;&nbsp;${escapeReportHtml(fmtFechaProf(d.fecha))}</p>

        <table>
          <thead><tr><th style="width:80px">CANTIDAD</th><th>DESCRIPCION</th><th style="width:95px">P. UNITARIO</th><th style="width:95px">P. TOTAL</th></tr></thead>
          <tbody>
            <tr>
              <td class="ctr desc-cell">1</td>
              <td class="desc-cell">
                Servicio de Transporte<br/><br/>
                <b>Ruta:</b> ${escapeReportHtml(d.servicio.origen)} → ${escapeReportHtml(d.servicio.destino)}<br/>
                <b>Salida:</b> ${escapeReportHtml(fmtFechaProf(d.servicio.fecha_servicio))}${d.servicio.hora_salida ? " · " + escapeReportHtml(d.servicio.hora_salida) : ""} · ${escapeReportHtml(d.servicio.num_personas)} pasajero(s)<br/><br/>
                ${d.servicio.fecha_regreso ? `<b>Regreso:</b> ${escapeReportHtml(fmtFechaProf(d.servicio.fecha_regreso))}${d.servicio.hora_regreso ? " · recogida " + escapeReportHtml(d.servicio.hora_regreso) : ""} · ${escapeReportHtml(d.servicio.destino)} → ${escapeReportHtml(d.servicio.origen)}<br/><br/>` : ""}
                ${escapeReportHtml(d.servicio.notas ? d.servicio.notas : "Servicio de transporte para traslado de personal.")}
              </td>
              <td class="num desc-cell">${fmtUSD(d.precio)}</td>
              <td class="num desc-cell">${fmtUSD(d.precio)}</td>
            </tr>
            <tr>
              <td class="noborder" colspan="2"></td>
              <td class="total-lbl">TOTAL USD</td>
              <td class="total-val">${fmtUSD(d.precio)}</td>
            </tr>
          </tbody>
        </table>

        <div class="foot">
          <div class="banco">
            <p><b>${escapeReportHtml(e.banco.nombre)}</b></p>
            <p><b>Cuenta:</b> ${escapeReportHtml(e.banco.tipo)}</p>
            <p><b>Numero:</b> ${escapeReportHtml(e.banco.numero)}</p>
            <p><b>Nombre:</b> ${escapeReportHtml(e.banco.titular)}</p>
            <p><b>RUC:</b> ${escapeReportHtml(e.banco.ruc)}</p>
          </div>
          <div class="firma">
            <p class="linea">${escapeReportHtml(e.gerente)}</p>
            <p class="cargo">${escapeReportHtml(e.cargoGerente)}</p>
          </div>
        </div>

        <div class="noprint" style="text-align:center;margin-top:30px">
          <button onclick="window.print()" style="background:#E31E24;color:#fff;border:none;padding:12px 30px;border-radius:10px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:1px">Descargar / Imprimir PDF</button>
        </div>
        </body></html>`;

      const win = openPrintableReport(html);
      if (!win) throw new Error("El navegador bloqueó la ventana emergente");
      load(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "No se pudo generar la proforma"); }
    finally { setProformaBusyId(null); }
  };

  // Envía la proforma al correo del cliente (previa confirmación del admin).
  const enviarProforma = async (c: Cotizacion) => {
    if (!(await confirmar({
      title: "Enviar proforma",
      message: `¿Enviar la proforma al correo del cliente (${c.cliente_email})?`,
      confirmText: "Enviar",
    }))) return;
    setProformaBusyId(c.id); setErr(""); setMsg("");
    try {
      const res = await fetch(`${API_URL}/api/admin/cotizaciones/${c.id}/proforma/enviar`, {
        method: "POST", headers: getAuthHeaders(),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "No se pudo enviar la proforma");
      setMsg(j.message || "Proforma enviada al cliente");
      load(true);
    } catch (e) { setErr(e instanceof Error ? e.message : "No se pudo enviar la proforma"); }
    finally { setProformaBusyId(null); }
  };

  // La proforma se puede generar cuando la cotización ya tiene un precio.
  const tieneProforma = (c: Cotizacion) =>
    c.estado !== "rechazada" && Number(c.precio_final) > 0;

  const openModal = async (cot: Cotizacion, mode: "view" | "aprobar" | "rechazar") => {
    setSelected(cot);
    setModalMode(mode);
    setPrecioFinal(cot.precio_final ? String(cot.precio_final) : "");
    setRespuesta("");
    setNego([]);
    setMsg(""); setErr("");
    try {
      const r = await fetch(`${API_URL}/api/admin/cotizaciones/${cot.id}/negociacion`, { headers: getAuthHeaders() });
      if (r.ok) setNego(await r.json());
    } catch { /* silencio */ }
  };

  // Si llegamos desde una notificación (?id=123), forzamos el filtro a "todas"
  // para asegurar que la cotización aparezca sin importar su estado.
  useEffect(() => {
    const requestParam = searchParams.get("requerimiento");
    if (requestParam) setActiveSection("requerimientos");
    const idParam = searchParams.get("id");
    if (!idParam) return;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) return;
    pendingFocusId.current = id;
    setFiltro("todas");
     
  }, [searchParams]);

  // Una vez cargada la lista, si hay una cotización pendiente de enfocar, la abrimos.
  useEffect(() => {
    if (!pendingFocusId.current || cotizaciones.length === 0) return;
    const target = cotizaciones.find((c) => c.id === pendingFocusId.current);
    if (target) {
      openModal(target, "view");
      pendingFocusId.current = null;
      router.replace("/admin/cotizaciones");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cotizaciones]);

  const handleAprobar = async () => {
    if (!selected || !precioFinal) { setErr("Ingresa el precio final"); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch(`${API_URL}/api/admin/cotizaciones/${selected.id}/aprobar`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          precio_final: Number(precioFinal),
          respuesta_admin: respuesta,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg(`✅ Cotización aprobada. Reserva #${data.reserva_id} creada; se asignará desde Despacho tras confirmarse el pago.`);
      setSelected(null);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "No se pudo aprobar la cotización. Intenta nuevamente."); }
    finally { setSaving(false); }
  };

  const handleRechazar = async () => {
    if (!selected) return;
    setSaving(true); setErr("");
    try {
      const res = await fetch(`${API_URL}/api/admin/cotizaciones/${selected.id}/rechazar`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ respuesta_admin: respuesta || "No disponible por el momento" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg("Cotización rechazada.");
      setSelected(null);
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Error inesperado"); }
    finally { setSaving(false); }
  };

  const saveCustomRequest = async (request: RequerimientoPersonalizado) => {
    setSavingCustomId(request.id);
    setErr("");
    setMsg("");
    try {
      const nextStatus = customStatuses[request.id] || request.estado;
      const storedGroupPrices = request.service_groups?.map(group =>
        group.precio_total == null ? "" : String(group.precio_total)
      ) || [];
      const groupPrices = customGroupPrices[request.id] || storedGroupPrices;
      const res = await fetch(`${API_URL}/api/admin/requerimientos-personalizados/${request.id}`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          estado: nextStatus,
          ...(customServiceGroups[request.id] ? { grupos_servicio: customServiceGroups[request.id] } : {}),
          ...((nextStatus === "propuesta_enviada" || customGroupPrices[request.id])
            ? { precios_grupo: groupPrices }
            : {}),
          respuesta_admin: customResponses[request.id] || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar el requerimiento");
      setMsg(`Requerimiento #${request.id} actualizado.`);
      await load(true);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "No se pudo actualizar el requerimiento");
    } finally {
      setSavingCustomId(null);
    }
  };

  const updateCustomServiceGroup = (
    request: RequerimientoPersonalizado,
    groupIndex: number,
    patch: Partial<NonNullable<RequerimientoPersonalizado["service_groups"]>[number]>
  ) => setCustomServiceGroups(current => {
    const groups = current[request.id] || request.service_groups || [];
    return {
      ...current,
      [request.id]: groups.map((group, index) => index === groupIndex ? { ...group, ...patch } : group),
    };
  });

  const downloadCustomProforma = async (request: RequerimientoPersonalizado) => {
    setSavingCustomId(request.id);
    setErr("");
    try {
      const response = await fetch(`${API_URL}/api/admin/requerimientos-personalizados/${request.id}/proforma`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "No se pudo descargar la proforma");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `proforma_requerimiento_${request.id}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "No se pudo descargar la proforma");
    } finally {
      setSavingCustomId(null);
    }
  };

  const retryCustomDispatch = async (request: RequerimientoPersonalizado) => {
    setSavingCustomId(request.id);
    setErr("");
    try {
      const response = await fetch(`${API_URL}/api/admin/requerimientos-personalizados/${request.id}/preparar-despacho`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo preparar el despacho");
      setMsg(`Despacho del requerimiento #${request.id} preparado: ${data.total} unidad(es).`);
      await load(true);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "No se pudo preparar el despacho");
    } finally {
      setSavingCustomId(null);
    }
  };

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="animate-spin text-[#E31E24]" size={36} />
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setActiveSection("cotizaciones")}
          className={`rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition ${activeSection === "cotizaciones" ? "bg-[#E31E24] text-white shadow-sm" : "border border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
          Cotizaciones
        </button>
        <button type="button" onClick={() => setActiveSection("requerimientos")}
          className={`rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition ${activeSection === "requerimientos" ? "bg-violet-700 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
          Requerimientos personalizados {customRequests.filter(request => request.estado === "pendiente" || request.estado === "en_revision").length > 0
            ? `(${customRequests.filter(request => request.estado === "pendiente" || request.estado === "en_revision").length})`
            : ""}
        </button>
      </div>

      {/* KPI CARDS */}
      {activeSection === "cotizaciones" && resumen && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {[
            { label: "Pendientes", val: resumen.pendientes, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", icon: Clock },
            { label: "Aprobadas", val: resumen.aprobadas,  color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", icon: CheckCircle2 },
            { label: "Rechazadas", val: resumen.rechazadas, color: "text-red-500", bg: "bg-red-50", border: "border-red-200", icon: XCircle },
            { label: "Ingresos generados", val: `$${Number(resumen.ingresos_generados).toFixed(0)}`, color: "text-slate-900", bg: "bg-white", border: "border-slate-200", icon: TrendingUp },
          ].map(k => (
            <div key={k.label} className={`${k.bg} border ${k.border} rounded-2xl p-4 sm:p-5 shadow-sm flex items-start justify-between`}>
              <div>
                <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-gray-400">{k.label}</p>
                <p className={`text-2xl sm:text-3xl font-black italic tracking-tighter mt-1 ${k.color}`}>{k.val}</p>
              </div>
              <k.icon size={20} className={k.color} />
            </div>
          ))}
        </div>
      )}

      {/* MENSAJES */}
      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-xl">{msg}</div>}
      {err && <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl">{err}</div>}

      {/* FILTRO TABS */}
      {activeSection === "cotizaciones" && <div className="flex gap-2 flex-wrap">
        {["pendiente", "aprobada", "rechazada", "todas"].map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filtro === f ? "bg-[#E31E24] text-white shadow-sm" : "bg-white border border-slate-200 text-slate-500 hover:border-slate-300"}`}>
            {f === "todas" ? "Todas" : ESTADO_LABEL[f]}
          </button>
        ))}
      </div>}

      {/* TABLA */}
      {activeSection === "cotizaciones" && <div className="bg-white rounded-2xl md:rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden border-b-8 border-b-[#E31E24]">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-[#E31E24]" size={36} />
          </div>
        ) : cotizaciones.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <FileText size={48} className="text-slate-200" />
            <p className="text-sm font-black uppercase text-slate-300 italic">Sin cotizaciones {filtro === "todas" ? "" : ESTADO_LABEL[filtro]?.toLowerCase()}s</p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-50">
              {cotizaciones.map(c => (
                <div key={c.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-black text-slate-900 text-sm">{c.cliente_nombre}</p>
                      <p className="text-[10px] text-slate-400">{c.cliente_email}</p>
                    </div>
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full border whitespace-nowrap ${ESTADO_BADGE[c.estado]}`}>
                      {ESTADO_LABEL[c.estado]}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-50 rounded-xl p-2.5">
                      <p className="text-[9px] text-slate-400 font-black uppercase">Origen</p>
                      <p className="font-bold text-slate-700 truncate">{c.origen}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-2.5">
                      <p className="text-[9px] text-slate-400 font-black uppercase">Destino</p>
                      <p className="font-bold text-slate-700 truncate">{c.destino}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openModal(c, "view")} className="flex-1 py-2 text-[10px] font-black uppercase bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 transition-all flex items-center justify-center gap-1">
                      <Eye size={12} /> Ver
                    </button>
                    {tieneProforma(c) && (
                      <>
                        <button onClick={() => verProforma(c)} disabled={proformaBusyId === c.id} className="flex-1 py-2 text-[10px] font-black uppercase bg-[#0b0f1a] hover:bg-black text-white rounded-xl transition-all flex items-center justify-center gap-1 disabled:opacity-60">
                          {proformaBusyId === c.id ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />} Proforma
                        </button>
                        <button onClick={() => enviarProforma(c)} disabled={proformaBusyId === c.id} className="py-2 px-3 text-[10px] font-black uppercase bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all flex items-center justify-center gap-1 disabled:opacity-60" title="Enviar proforma al correo del cliente">
                          <Send size={12} />
                        </button>
                      </>
                    )}
                    {c.estado === "pendiente" && (
                      <>
                        <button onClick={() => openModal(c, "aprobar")} className="flex-1 py-2 text-[10px] font-black uppercase bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-all flex items-center justify-center gap-1">
                          <Check size={12} /> Aprobar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-[900px] w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-100">
                    {["#", "Cliente", "Ruta", "Fecha", "Personas", "Tipo Vehículo", "Estado", "Acciones"].map(h => (
                      <th key={h} className="px-5 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {cotizaciones.map(c => (
                    <tr key={c.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="px-5 py-4 text-xs font-black text-slate-400">#{c.id}</td>
                      <td className="px-5 py-4">
                        <p className="font-black text-slate-900 text-sm">{c.cliente_nombre}</p>
                        <p className="text-[10px] text-slate-400">{c.cliente_email}</p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                          <MapPin size={12} className="text-[#E31E24] flex-shrink-0" />
                          <span className="truncate max-w-[140px]">{c.origen}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-1">
                          <MapPin size={10} className="flex-shrink-0" />
                          <span className="truncate max-w-[140px]">{c.destino}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs font-bold text-slate-600 whitespace-nowrap">
                        {new Date(c.fecha_servicio).toLocaleDateString("es-EC")}
                        {c.fecha_fin && c.fecha_fin !== c.fecha_servicio && (
                          <span className="block text-[10px] text-[#E31E24] font-black">→ {new Date(c.fecha_fin).toLocaleDateString("es-EC")}</span>
                        )}
                        {c.fecha_regreso && (
                          <span className="block text-[10px] text-blue-600 font-black">Regreso: {new Date(c.fecha_regreso).toLocaleDateString("es-EC")}{c.hora_regreso ? ` · ${c.hora_regreso}` : ""}</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm font-black text-slate-700">{c.num_personas}</td>
                      <td className="px-5 py-4 text-xs text-slate-600 capitalize">{c.tipo_vehiculo || "—"}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-[9px] font-black uppercase border ${ESTADO_BADGE[c.estado]}`}>
                          {ESTADO_LABEL[c.estado]}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex gap-1.5">
                          <button onClick={() => openModal(c, "view")} className="p-2 hover:bg-slate-100 rounded-xl transition-all text-slate-500" title="Ver detalles">
                            <Eye size={15} />
                          </button>
                          {tieneProforma(c) && (
                            <>
                              <button onClick={() => verProforma(c)} disabled={proformaBusyId === c.id} className="p-2 hover:bg-slate-200 bg-slate-100 rounded-xl transition-all text-slate-700 disabled:opacity-60" title="Ver / imprimir proforma">
                                {proformaBusyId === c.id ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
                              </button>
                              <button onClick={() => enviarProforma(c)} disabled={proformaBusyId === c.id} className="p-2 hover:bg-blue-50 rounded-xl transition-all text-blue-600 disabled:opacity-60" title="Enviar proforma al correo del cliente">
                                <Send size={15} />
                              </button>
                            </>
                          )}
                          {c.estado === "pendiente" && (
                            <>
                              <button onClick={() => openModal(c, "aprobar")} className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-xl transition-all" title="Aprobar">
                                <Check size={15} />
                              </button>
                              <button onClick={() => openModal(c, "rechazar")} className="p-2 hover:bg-red-50 text-red-500 rounded-xl transition-all" title="Rechazar">
                                <X size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>}

      {activeSection === "requerimientos" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <h2 className="text-sm font-black text-violet-950">Solicitudes que requieren coordinación especial</h2>
            <p className="mt-1 text-xs leading-relaxed text-violet-800">Revisa la necesidad completa, evalúa disponibilidad propia o externa y deja una respuesta para que el cliente pueda verla en su cuenta.</p>
          </div>
          {loading ? (
            <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white">
              <Loader2 className="animate-spin text-violet-700" size={32} />
            </div>
          ) : customRequests.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white text-slate-400">
              <FileText size={36} className="text-slate-200" />
              <p className="text-xs font-black uppercase tracking-widest">No hay requerimientos personalizados</p>
            </div>
          ) : customRequests.map(request => (
            <article key={request.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
                <div>
                  <p className="text-sm font-black text-slate-900">
                    Requerimiento #{request.id}{request.organizacion ? ` · ${request.organizacion}` : ""}
                  </p>
                  <p className="mt-1 text-xs font-bold text-slate-600">{request.cliente_nombre}</p>
                  <p className="text-[11px] text-slate-400">
                    {request.cliente_email}{request.cliente_telefono ? ` · ${request.cliente_telefono}` : ""}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase ${
                  ["propuesta_enviada", "pago_pendiente", "pagado"].includes(request.estado) ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : ["cerrado", "rechazado"].includes(request.estado) ? "border-slate-200 bg-slate-50 text-slate-500"
                      : request.estado === "en_revision" ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                }`}>
                  {({
                    pendiente: "Pendiente",
                    en_revision: "En revisión",
                    respondido: "Respondido",
                    propuesta_enviada: "Propuesta enviada",
                    pago_pendiente: "Pago pendiente",
                    pagado: "Pagado",
                    cerrado: "Cerrado",
                    rechazado: "Rechazado",
                  } as Record<string, string>)[request.estado] || request.estado}
                </span>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
                {(request.service_groups?.length ? request.service_groups : [{
                  cantidad_vehiculos: request.cantidad_vehiculos,
                  tipo_vehiculo: request.tipo_vehiculo,
                  pasajeros_por_vehiculo: request.pasajeros_por_vehiculo,
                  fecha_servicio: request.fecha_servicio,
                  fecha_fin: request.fecha_fin,
                  hora_salida: request.hora_salida,
                  origen: request.origen,
                  destino: request.destino,
                  paradas: null,
                  detalles: null,
                  simultaneo: false,
                  precio_total: request.precio_final,
                }]).map((group, groupIndex) => (
                  <div key={groupIndex} className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-violet-700">Grupo {groupIndex + 1}</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">
                      {group.cantidad_vehiculos} vehículo(s)
                      {group.tipo_vehiculo ? ` · ${group.tipo_vehiculo}` : ""}
                      {group.pasajeros_por_vehiculo ? ` · ${group.pasajeros_por_vehiculo} pasajeros por unidad` : ""}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {group.origen || "Salida por definir"} → {group.destino || "Destino(s) por definir"}
                      {group.fecha_servicio ? ` · ${new Date(`${String(group.fecha_servicio).slice(0, 10)}T00:00:00`).toLocaleDateString("es-EC")}` : ""}
                      {group.fecha_fin ? ` — ${new Date(`${String(group.fecha_fin).slice(0, 10)}T00:00:00`).toLocaleDateString("es-EC")}` : ""}
                      {group.hora_salida ? ` · ${group.hora_salida}` : ""}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">Tipo solicitado
                        <input maxLength={100} disabled={Boolean(request.reserva_id)}
                          value={customServiceGroups[request.id]?.[groupIndex]?.tipo_vehiculo ?? group.tipo_vehiculo ?? ""}
                          onChange={event => updateCustomServiceGroup(request, groupIndex, { tipo_vehiculo: event.target.value })}
                          className={`${INPUT_CLS} mt-1`} />
                      </label>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">Fecha de servicio
                        <input type="date" disabled={Boolean(request.reserva_id)}
                          value={customServiceGroups[request.id]?.[groupIndex]?.fecha_servicio ?? group.fecha_servicio?.slice(0, 10) ?? ""}
                          onChange={event => updateCustomServiceGroup(request, groupIndex, { fecha_servicio: event.target.value || null })}
                          className={`${INPUT_CLS} mt-1`} />
                      </label>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">Pasajeros por unidad
                        <input type="number" min="1" disabled={Boolean(request.reserva_id)}
                          value={customServiceGroups[request.id]?.[groupIndex]?.pasajeros_por_vehiculo ?? group.pasajeros_por_vehiculo ?? ""}
                          onChange={event => updateCustomServiceGroup(request, groupIndex, {
                            pasajeros_por_vehiculo: event.target.value ? Number(event.target.value) : null,
                          })}
                          className={`${INPUT_CLS} mt-1`} />
                      </label>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">Origen
                        <input maxLength={300} disabled={Boolean(request.reserva_id)}
                          value={customServiceGroups[request.id]?.[groupIndex]?.origen ?? group.origen ?? ""}
                          onChange={event => updateCustomServiceGroup(request, groupIndex, { origen: event.target.value })}
                          className={`${INPUT_CLS} mt-1`} />
                      </label>
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">Destino
                        <input maxLength={300} disabled={Boolean(request.reserva_id)}
                          value={customServiceGroups[request.id]?.[groupIndex]?.destino ?? group.destino ?? ""}
                          onChange={event => updateCustomServiceGroup(request, groupIndex, { destino: event.target.value })}
                          className={`${INPUT_CLS} mt-1`} />
                      </label>
                    </div>
                    {group.paradas && <p className="mt-1 text-xs text-slate-600"><b>Paradas:</b> {group.paradas}</p>}
                    {group.detalles && <p className="mt-1 whitespace-pre-line text-xs text-slate-600"><b>Indicaciones:</b> {group.detalles}</p>}
                    {group.simultaneo && <p className="mt-1 text-[10px] font-black text-violet-700">Operación simultánea solicitada</p>}
                    <label className="mt-3 block max-w-xs text-[9px] font-black uppercase tracking-widest text-slate-500">
                      Precio total del grupo ($)
                      <input type="number" min="0.01" step="0.01" disabled={Boolean(request.reserva_id)}
                        value={customGroupPrices[request.id]?.[groupIndex] ?? (group.precio_total == null ? "" : String(group.precio_total))}
                        onChange={event => setCustomGroupPrices(current => {
                          const base = request.service_groups?.length
                            ? request.service_groups.map(item => item.precio_total == null ? "" : String(item.precio_total))
                            : [group.precio_total == null ? "" : String(group.precio_total)];
                          const existing = current[request.id]?.length === base.length ? current[request.id] : base;
                          const next = [...existing];
                          next[groupIndex] = event.target.value;
                          return { ...current, [request.id]: next };
                        })}
                        placeholder="Ej: 1500.00" className={`${INPUT_CLS} mt-1`} />
                    </label>
                  </div>
                ))}
                <div className="rounded-xl border border-violet-100 bg-violet-50 p-3 sm:col-span-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-violet-700">Detalle enviado por el cliente</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-violet-950">{request.detalles}</p>
                </div>
                <div className="space-y-3 sm:col-span-2">
                  {request.error_despacho && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">No se pudo preparar el despacho: {request.error_despacho}</p>}
                  {request.reserva_id && <p className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs font-bold text-cyan-800">
                    Reserva de pago #{request.reserva_id} · Despacho: {request.estado_despacho || "pendiente"}
                  </p>}
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                    <div>
                      <label htmlFor={`custom-status-${request.id}`} className="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-slate-500">Estado</label>
                      <select id={`custom-status-${request.id}`} value={customStatuses[request.id] || request.estado}
                        disabled={Boolean(request.reserva_id)}
                        onChange={event => setCustomStatuses(current => ({ ...current, [request.id]: event.target.value }))}
                        className={INPUT_CLS}>
                        <option value="pendiente">Pendiente</option>
                        <option value="en_revision">En revisión</option>
                        <option value="respondido">Respondido</option>
                        <option value="propuesta_enviada">Enviar propuesta</option>
                        <option value="cerrado">Cerrado</option>
                        <option value="rechazado">Rechazado</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`custom-response-${request.id}`} className="mb-1.5 block text-[9px] font-black uppercase tracking-widest text-slate-500">Respuesta visible para el cliente</label>
                      <textarea id={`custom-response-${request.id}`} rows={3} maxLength={5000}
                        disabled={Boolean(request.reserva_id)}
                        value={customResponses[request.id] ?? request.respuesta_admin ?? ""}
                        onChange={event => setCustomResponses(current => ({ ...current, [request.id]: event.target.value }))}
                        placeholder="Indica disponibilidad, preguntas para aclarar o próximos pasos para preparar una propuesta."
                        className={INPUT_CLS + " resize-y"} />
                    </div>
                  </div>
                  <button type="button" onClick={() => void saveCustomRequest(request)} disabled={savingCustomId === request.id || Boolean(request.reserva_id)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-violet-900 disabled:opacity-60">
                    {savingCustomId === request.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Guardar y notificar al cliente
                  </button>
                  {["propuesta_enviada", "pago_pendiente", "pagado"].includes(request.estado) && <button type="button" onClick={() => void downloadCustomProforma(request)} disabled={savingCustomId === request.id}
                    className="ml-2 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-60">
                    <Download size={14} /> Descargar proforma
                  </button>}
                  {request.estado_despacho === "error" && <button type="button" onClick={() => void retryCustomDispatch(request)} disabled={savingCustomId === request.id}
                    className="ml-2 inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-60">
                    <RefreshCw size={14} /> Reintentar despacho
                  </button>}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* MODAL */}
      {selected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b0f1a]/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-[2rem] bg-white shadow-2xl overflow-hidden animate-in zoom-in-95 my-4">
            {/* Modal Header */}
            <div className={`p-5 sm:p-6 flex items-center justify-between text-white ${modalMode === "aprobar" ? "bg-emerald-600" : modalMode === "rechazar" ? "bg-red-600" : "bg-[#0b0f1a]"}`}>
              <div className="flex items-center gap-3">
                <div className="bg-white/20 p-2 rounded-xl">
                  {modalMode === "aprobar" ? <Check size={20} /> : modalMode === "rechazar" ? <X size={20} /> : <Eye size={20} />}
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-black italic tracking-tighter uppercase">
                    {modalMode === "aprobar" ? "Fijar precio y aprobar" : modalMode === "rechazar" ? "Rechazar Cotización" : "Detalle de Cotización"}
                  </h2>
                  <p className="text-[10px] text-white/70 font-bold">Cotización #{selected.id}</p>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={18} /></button>
            </div>

            <div className="p-5 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Cliente info */}
              <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cliente</p>
                <p className="font-black text-slate-900">{selected.cliente_nombre}</p>
                <p className="text-xs text-slate-500">{selected.cliente_email}</p>
                {selected.cliente_telefono && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-500">{selected.cliente_telefono}</p>
                    <WhatsAppButton telefono={selected.cliente_telefono} title={`WhatsApp de ${selected.cliente_nombre}`} mensaje={`Hola ${selected.cliente_nombre}, le contactamos de Turesma sobre su cotización #${selected.id}.`} />
                  </div>
                )}
              </div>

              {/* Ruta */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1"><MapPin size={9} />Origen</p>
                  <p className="text-sm font-bold text-slate-700">{selected.origen}</p>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1"><MapPin size={9} />Destino</p>
                  <p className="text-sm font-bold text-slate-700">{selected.destino}</p>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1"><Calendar size={9} />Fecha</p>
                  <p className="text-sm font-bold text-slate-700">
                    {new Date(selected.fecha_servicio).toLocaleDateString("es-EC")}
                    {selected.fecha_fin && selected.fecha_fin !== selected.fecha_servicio && ` → ${new Date(selected.fecha_fin).toLocaleDateString("es-EC")}`}
                  </p>
                </div>
                {selected.fecha_regreso && (
                  <div className="col-span-2 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <p className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-blue-600">
                      <Calendar size={9} /> Regreso en otra fecha
                    </p>
                    <p className="text-sm font-bold text-slate-700">
                      {new Date(selected.fecha_regreso).toLocaleDateString("es-EC")}
                      {selected.hora_regreso && ` · Recogida a las ${selected.hora_regreso}`}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{selected.destino} → {selected.origen}</p>
                  </div>
                )}
                <div className="bg-slate-50 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 flex items-center gap-1"><Users size={9} />Personas</p>
                  <p className="text-sm font-bold text-slate-700">{selected.num_personas}</p>
                </div>
              </div>

              {/* Vehículo elegido / duración / valor ofrecido */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-2xl p-4 flex items-center gap-3">
                  <Car size={16} className="text-[#E31E24] flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {selected.vehiculo_placa ? "Vehículo asignado" : "Categoría solicitada"}
                    </p>
                    <p className="text-sm font-bold text-slate-700 truncate">
                      {selected.vehiculo_placa ? `${selected.vehiculo_placa}${selected.vehiculo_modelo ? " · " + selected.vehiculo_modelo : ""}` : (selected.tipo_vehiculo || "Sin preferencia")}
                    </p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 flex items-center gap-3">
                  <Clock size={16} className="text-blue-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Hora de salida</p>
                    <p className="text-sm font-bold text-slate-700">{selected.hora_salida || "—"}</p>
                  </div>
                </div>
              </div>

              {selected.valor_ofrecido != null && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
                  <DollarSign size={18} className="text-amber-600 flex-shrink-0" />
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">Valor ofrecido por el cliente</p>
                    <p className="text-lg font-black text-amber-700">${Number(selected.valor_ofrecido).toFixed(2)}</p>
                  </div>
                </div>
              )}
              {selected.notas && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-amber-600 mb-1 flex items-center gap-1"><MessageSquare size={9} />Mensaje del cliente</p>
                  <p className="text-sm text-amber-800 whitespace-pre-line">{selected.notas}</p>
                </div>
              )}

              {selected.respuesta_admin && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-blue-600 mb-1">Respuesta del admin</p>
                  <p className="text-sm text-blue-800">{selected.respuesta_admin}</p>
                </div>
              )}

              {/* HISTORIAL DE NEGOCIACIÓN */}
              {nego.length > 0 && (
                <div className="bg-slate-50 rounded-2xl p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-3">Historial de precios</p>
                  <div className="space-y-2">
                    {nego.map((h, i) => (
                      <div key={i} className={`flex ${h.actor === "admin" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${h.actor === "admin" ? "bg-[#E31E24] text-white" : "bg-white border border-slate-200 text-slate-700"}`}>
                          <p className="text-[8px] font-black uppercase tracking-widest opacity-70">{h.actor === "admin" ? "Turesma" : "Cliente"}</p>
                          {h.precio != null && <p className="text-sm font-black">${Number(h.precio).toFixed(2)}</p>}
                          {h.mensaje && <p className="text-[11px] opacity-90">{h.mensaje}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Acciones */}
              {modalMode === "aprobar" && (
                <div className="space-y-3 pt-2">
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Asignación por Despacho</p>
                    <p className="mt-1 text-xs leading-relaxed text-blue-800">
                      La categoría solicitada ({selected.tipo_vehiculo || "sin preferencia"}) es solo una referencia. El vehículo y el conductor se asignarán desde Despacho después de que el cliente complete el pago.
                    </p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Precio Final ($) *</label>
                    <div className="flex items-center gap-2 rounded-xl border-2 border-slate-100 bg-slate-50 px-4 py-3 focus-within:border-emerald-500 transition-all">
                      <DollarSign size={16} className="text-emerald-600" />
                      <input
                        type="number" step="0.01" min="0"
                        value={precioFinal}
                        onChange={e => setPrecioFinal(e.target.value)}
                        placeholder="Ej: 150.00"
                        className="w-full bg-transparent font-bold text-slate-700 outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Mensaje para el cliente (opcional)</label>
                    <textarea
                      value={respuesta}
                      onChange={e => setRespuesta(e.target.value)}
                      rows={2}
                      placeholder="Ej: Su cotización fue aprobada. Tras confirmar el pago, asignaremos el vehículo desde Despacho."
                      className={INPUT_CLS + " resize-none"}
                    />
                  </div>
                  {err && <p className="text-red-600 text-xs font-bold">{err}</p>}
                  <button onClick={handleAprobar} disabled={saving || !precioFinal}
                    className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    Confirmar Aprobación
                  </button>
                </div>
              )}

              {modalMode === "rechazar" && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5 block">Motivo del rechazo</label>
                    <textarea
                      value={respuesta}
                      onChange={e => setRespuesta(e.target.value)}
                      rows={3}
                      placeholder="Ej: No tenemos disponibilidad para esa fecha..."
                      className={INPUT_CLS + " resize-none"}
                    />
                  </div>
                  {err && <p className="text-red-600 text-xs font-bold">{err}</p>}
                  <button onClick={handleRechazar} disabled={saving}
                    className="w-full py-3.5 bg-[#E31E24] hover:bg-red-700 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                    Confirmar Rechazo
                  </button>
                </div>
              )}

              {modalMode === "view" && selected.estado === "pendiente" && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <button onClick={() => setModalMode("aprobar")} className="py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-[10px] uppercase rounded-2xl transition-all flex items-center justify-center gap-1">
                    <Check size={14} /> Aprobar
                  </button>
                  <button onClick={() => setModalMode("rechazar")} className="py-3 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-black text-[10px] uppercase rounded-2xl transition-all flex items-center justify-center gap-1">
                    <X size={14} /> Rechazar
                  </button>
                </div>
              )}

              {selected.reserva_id && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
                  <CheckCircle2 size={20} className="text-emerald-600" />
                  <div>
                    <p className="text-xs font-black text-emerald-700">Reserva generada</p>
                    <p className="text-[10px] text-emerald-600">Reserva #{selected.reserva_id} creada en el sistema</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// useSearchParams() debe ir dentro de un <Suspense> para que el build de
// producción de Next.js no falle (bailout de renderizado en cliente).
export default function AdminCotizacionesPage() {
  return (
    <Suspense fallback={null}>
      <AdminCotizacionesContent />
    </Suspense>
  );
}
