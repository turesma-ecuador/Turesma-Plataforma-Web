"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders } from "../../../lib/session";
import { useConfirm } from "../../../components/confirm-dialog";
import {
  Images, Loader2, UploadCloud, Trash2, Eye, EyeOff, X, Plus, CheckCircle2, Video, MapPin, GripVertical, ArrowUpRight,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.turesma.com";

const createVideoPoster = (file: File): Promise<Blob | null> => new Promise((resolve) => {
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  let finished = false;

  const finish = (poster: Blob | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    video.removeEventListener("loadeddata", captureFrame);
    video.removeEventListener("error", handleError);
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
    resolve(poster);
  };

  const captureFrame = () => {
    if (!video.videoWidth || !video.videoHeight) {
      finish(null);
      return;
    }

    const scale = Math.min(1, 960 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) {
      finish(null);
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(finish, "image/jpeg", 0.82);
  };

  const handleError = () => finish(null);
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  video.addEventListener("loadeddata", captureFrame, { once: true });
  video.addEventListener("error", handleError, { once: true });
  const timeout = setTimeout(() => finish(null), 10_000);
  video.src = sourceUrl;
  video.load();
});

type Foto = {
  id: number;
  imagen_url: string;
  tipo: "imagen" | "video";
  categoria: "viajes" | "destinos";
  video_offset_x?: number | null;
  video_offset_y?: number | null;
  video_zoom?: number | null;
  video_format?: "original" | "horizontal" | "vertical";
  video_aspect_ratio?: number | null;
  video_poster_url?: string | null;
  titulo: string | null;
  descripcion: string | null;
  credito: string | null;
  fuente_url: string | null;
  licencia: string | null;
  licencia_url: string | null;
  orden: number;
  activo: boolean;
  creado_en: string;
};

export default function AdminGaleriaPage() {
  const { checkingSession } = useAdminGuard();
  const confirmar = useConfirm();
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoria, setCategoria] = useState<"viajes" | "destinos">("viajes");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // Formulario de nuevo contenido
  const [imagenUrl, setImagenUrl] = useState("");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [tipoContenido, setTipoContenido] = useState<"imagen" | "video">("imagen");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [draggedVideoId, setDraggedVideoId] = useState<number | null>(null);
  const [reorderingVideos, setReorderingVideos] = useState(false);
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPosterPreview, setVideoPosterPreview] = useState<string | null>(null);
  const [videoPosterBlob, setVideoPosterBlob] = useState<Blob | null>(null);
  const [videoPosterUrl, setVideoPosterUrl] = useState("");
  const [videoOffsetX, setVideoOffsetX] = useState(0);
  const [videoOffsetY, setVideoOffsetY] = useState(0);
  const [videoZoom, setVideoZoom] = useState(100);
  const [videoFormat, setVideoFormat] = useState<"original" | "horizontal" | "vertical">("original");
  const [videoOriginalAspectRatio, setVideoOriginalAspectRatio] = useState(16 / 9);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const posterRequestRef = useRef(0);
  const fotosCategoria = fotos.filter((foto) => foto.categoria === categoria);
  const imagenes = fotosCategoria.filter((foto) => foto.tipo === "imagen");
  const videos = fotosCategoria
    .filter((foto) => foto.tipo === "video")
    .sort((a, b) => a.orden - b.orden || new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime());
  const previewAspectRatio = videoFormat === "vertical"
    ? 9 / 16
    : videoFormat === "horizontal"
      ? 16 / 9
      : videoOriginalAspectRatio;

  const flash = (setter: (v: string) => void, value: string) => {
    setter(value);
    setTimeout(() => setter(""), 4000);
  };

  const cambiarCategoria = (next: "viajes" | "destinos") => {
    posterRequestRef.current += 1;
    setCategoria(next);
    setImagenUrl("");
    setImagePreviewUrl(null);
    setVideoPreview(null);
    setSelectedVideo(null);
    setVideoPosterPreview(null);
    setVideoPosterBlob(null);
    setVideoPosterUrl("");
    setVideoFormat("original");
    setVideoOriginalAspectRatio(16 / 9);
    if (next === "destinos") setTipoContenido("imagen");
    if (fileRef.current) fileRef.current.value = "";
  };

  useEffect(() => {
    if (!videoPreview?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(videoPreview);
  }, [videoPreview]);

  useEffect(() => {
    if (!imagePreviewUrl?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (!videoPosterPreview?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(videoPosterPreview);
  }, [videoPosterPreview]);

  const load = async () => {
    try {
      const res = await fetch(`${API}/api/admin/galeria`, { headers: getAuthHeaders() });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message = json?.error || "No se pudo cargar la galería";
        throw new Error(`${message} (HTTP ${res.status} en ${new URL(API).host})`);
      }
      setFotos(json);
      setErr("");
    } catch (error) {
      flash(setErr, error instanceof Error ? error.message : "No se pudo cargar la galería");
    }
    finally { setLoading(false); }
  };

  useEffect(() => { if (!checkingSession) load(); }, [checkingSession]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setImagePreviewUrl(URL.createObjectURL(file));
    setImagenUrl("");
    setErr(""); setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("imagen", file);
      const authToken = getAuthHeaders()["Authorization"];
      const res = await fetch(`${API}/api/admin/uploads/galeria-imagen`, {
        method: "POST",
        body: fd,
        headers: authToken ? { Authorization: authToken } : {},
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al subir la imagen");
      setImagenUrl(json.imageUrl || "");
      setImagePreviewUrl(json.imageUrl || null);
    } catch (e) { flash(setErr, e instanceof Error ? e.message : "No se pudo subir la imagen"); }
    finally { setSubiendo(false); }
  };

  const selectVideo = (file: File | null) => {
    if (!file) return;
    const posterRequest = ++posterRequestRef.current;
    setErr("");
    setImagenUrl("");
    setImagePreviewUrl(null);
    setSelectedVideo(file);
    setVideoPreview(URL.createObjectURL(file));
    setVideoPosterPreview(null);
    setVideoPosterBlob(null);
    setVideoPosterUrl("");
    setVideoOffsetX(0);
    setVideoOffsetY(0);
    setVideoZoom(100);
    setVideoFormat("original");
    setVideoOriginalAspectRatio(16 / 9);
    if (fileRef.current) fileRef.current.value = "";
    void createVideoPoster(file).then((poster) => {
      if (posterRequestRef.current !== posterRequest || !poster) return;
      setVideoPosterBlob(poster);
      setVideoPosterPreview(URL.createObjectURL(poster));
    });
  };

  const handleUploadVideo = async () => {
    if (!selectedVideo) return;
    setErr(""); setSubiendo(true);
    try {
      let posterBlob = videoPosterBlob;
      if (!posterBlob) {
        posterBlob = await createVideoPoster(selectedVideo);
        if (posterBlob) {
          setVideoPosterBlob(posterBlob);
          setVideoPosterPreview(URL.createObjectURL(posterBlob));
        }
      }
      const fd = new FormData();
      fd.append("video", selectedVideo);
      if (posterBlob) fd.append("poster", posterBlob, "video-preview.jpg");
      const authToken = getAuthHeaders()["Authorization"];
      const res = await fetch(`${API}/api/admin/uploads/galeria-video`, {
        method: "POST",
        body: fd,
        headers: authToken ? { Authorization: authToken } : {},
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al subir el video");
      setImagenUrl(json.videoUrl || "");
      setVideoPosterUrl(json.posterUrl || "");
      if (!json.posterUrl) {
        flash(setErr, "No se pudo crear la miniatura; el video se publicará con un fondo alternativo.");
      }
    } catch (e) { flash(setErr, e instanceof Error ? e.message : "No se pudo subir el video"); }
    finally { setSubiendo(false); }
  };

  const handleGuardar = async () => {
    if (!imagenUrl) { flash(setErr, "Primero sube un archivo"); return; }
    setGuardando(true); setErr("");
    try {
      const res = await fetch(`${API}/api/admin/galeria`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          imagen_url: imagenUrl,
          tipo: tipoContenido,
          categoria,
          video_offset_x: videoOffsetX,
          video_offset_y: videoOffsetY,
          video_zoom: videoZoom,
          video_format: videoFormat,
          video_aspect_ratio: videoOriginalAspectRatio,
          video_poster_url: videoPosterUrl,
          titulo,
          descripcion,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al guardar");
      setFotos((p) => [json, ...p]);
      posterRequestRef.current += 1;
      setImagenUrl(""); setTitulo(""); setDescripcion(""); setVideoPreview(null); setSelectedVideo(null);
      setImagePreviewUrl(null);
      setVideoPosterPreview(null); setVideoPosterBlob(null); setVideoPosterUrl("");
      setVideoFormat("original"); setVideoOriginalAspectRatio(16 / 9);
      if (fileRef.current) fileRef.current.value = "";
      flash(setMsg, `${tipoContenido === "video" ? "Video" : "Foto"} publicado en ${categoria === "destinos" ? "Destinos" : "Viajes"}`);
    } catch (e) { flash(setErr, e instanceof Error ? e.message : "No se pudo guardar"); }
    finally { setGuardando(false); }
  };

  const toggleActivo = async (foto: Foto) => {
    setActingId(foto.id);
    try {
      const res = await fetch(`${API}/api/admin/galeria/${foto.id}`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !foto.activo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo actualizar la visibilidad");
      setFotos((p) => p.map((f) => (f.id === foto.id ? json : f)));
    } catch (error) {
      flash(setErr, error instanceof Error ? error.message : "No se pudo actualizar la visibilidad");
    }
    finally { setActingId(null); }
  };

  const eliminar = async (id: number) => {
    if (!(await confirmar({ title: "Eliminar foto", message: "¿Eliminar esta foto de la galería? No se puede deshacer.", confirmText: "Eliminar", tone: "danger" }))) return;
    setActingId(id);
    try {
      const res = await fetch(`${API}/api/admin/galeria/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo eliminar la foto");
      setFotos((p) => p.filter((f) => f.id !== id));
      flash(setMsg, "Foto eliminada");
    } catch (error) {
      flash(setErr, error instanceof Error ? error.message : "No se pudo eliminar la foto");
    }
    finally { setActingId(null); }
  };

  const reordenarVideos = async (draggedId: number, targetId: number) => {
    if (draggedId === targetId || reorderingVideos) return;
    const previousVideos = [...videos];
    const reorderedVideos = [...videos];
    const fromIndex = reorderedVideos.findIndex((video) => video.id === draggedId);
    const toIndex = reorderedVideos.findIndex((video) => video.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [draggedVideo] = reorderedVideos.splice(fromIndex, 1);
    reorderedVideos.splice(toIndex, 0, draggedVideo);
    const orderById = new Map(reorderedVideos.map((video, index) => [video.id, index]));
    setFotos((current) => current.map((foto) => (
      orderById.has(foto.id) ? { ...foto, orden: orderById.get(foto.id)! } : foto
    )));
    setReorderingVideos(true);

    try {
      const res = await fetch(`${API}/api/admin/galeria/orden-videos`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reorderedVideos.map((video) => video.id) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo guardar el orden");
      flash(setMsg, "Orden de videos guardado");
    } catch (error) {
      const previousOrderById = new Map(previousVideos.map((video) => [video.id, video.orden]));
      setFotos((current) => current.map((foto) => {
        const previousOrder = previousOrderById.get(foto.id);
        return previousOrder === undefined ? foto : { ...foto, orden: previousOrder };
      }));
      flash(setErr, error instanceof Error ? error.message : "No se pudo guardar el orden");
    } finally {
      setReorderingVideos(false);
    }
  };

  const renderContenido = (contenido: Foto, index: number) => (
    <div
      key={contenido.id}
      onDragOver={(event) => {
        if (contenido.tipo === "video" && draggedVideoId !== null) event.preventDefault();
      }}
      onDrop={(event) => {
        if (contenido.tipo !== "video" || draggedVideoId === null) return;
        event.preventDefault();
        void reordenarVideos(draggedVideoId, contenido.id);
        setDraggedVideoId(null);
      }}
      className={`group bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${draggedVideoId === contenido.id ? "border-[#E31E24] opacity-50" : "border-slate-200"} ${contenido.activo ? "" : "opacity-60"}`}
    >
      <div className={`relative ${contenido.tipo === "video" ? "flex aspect-video items-center justify-center bg-slate-950" : "aspect-[4/3] bg-slate-100 cursor-zoom-in"}`} onClick={() => contenido.tipo === "imagen" && setZoomImg(contenido.imagen_url)}>
        {contenido.tipo === "video" ? (
          <>
            {contenido.video_poster_url && (
              <Image
                src={contenido.video_poster_url}
                alt=""
                aria-hidden="true"
                fill
                sizes="(max-width: 768px) 50vw, 25vw"
                unoptimized
                className="pointer-events-none scale-110 object-cover opacity-60 blur-2xl"
              />
            )}
            <span className="absolute left-2 top-2 z-20 rounded-lg bg-slate-950/75 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-white">
              {index === 0 ? "Grande · izquierda" : index % 3 === 1 ? "Pequeño · arriba" : index % 3 === 2 ? "Pequeño · abajo" : `Mosaico ${Math.floor(index / 3) + 1} · grande`}
            </span>
            <button
              type="button"
              draggable={!reorderingVideos}
              disabled={reorderingVideos}
              aria-label={`Arrastrar para cambiar el orden de ${contenido.titulo || "este video"}`}
              onDragStart={(event: DragEvent<HTMLButtonElement>) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(contenido.id));
                setDraggedVideoId(contenido.id);
              }}
              onDragEnd={() => setDraggedVideoId(null)}
              className="absolute right-2 top-2 z-20 flex cursor-grab items-center gap-1 rounded-lg bg-slate-950/75 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-white active:cursor-grabbing disabled:opacity-50"
              title="Arrastra este video para cambiar su posición"
            >
              <GripVertical size={13} /> Mover
            </button>
            <video
              src={contenido.imagen_url}
              poster={contenido.video_poster_url || undefined}
              preload={contenido.video_poster_url ? "metadata" : "auto"}
              controls
              style={{
                aspectRatio: contenido.video_format === "vertical"
                  ? 9 / 16
                  : contenido.video_format === "horizontal"
                    ? 16 / 9
                    : contenido.video_aspect_ratio || 16 / 9,
                width: (contenido.video_format === "vertical" || (!contenido.video_format && (contenido.video_aspect_ratio || 16 / 9) < 1)) ? "auto" : "100%",
                height: (contenido.video_format === "vertical" || (!contenido.video_format && (contenido.video_aspect_ratio || 16 / 9) < 1)) ? "100%" : "auto",
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                transform: `translate(${contenido.video_offset_x || 0}%, ${contenido.video_offset_y || 0}%) scale(${(contenido.video_zoom || 100) / 100})`,
              }}
              className="relative z-10 bg-transparent"
            />
          </>
        ) : (
          <Image src={contenido.imagen_url} alt={contenido.titulo || "Foto de viaje"} fill sizes="(max-width: 768px) 50vw, 25vw" unoptimized className="object-cover" />
        )}
        {!contenido.activo && (
          <span className="absolute top-2 left-2 bg-slate-900/80 text-white text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg">Oculta</span>
        )}
      </div>
      <div className="p-3">
        {contenido.titulo ? (
          <p className="text-sm font-black text-slate-800 truncate">{contenido.titulo}</p>
        ) : (
          <p className="text-sm font-bold text-slate-300 italic">Sin título</p>
        )}
        {contenido.descripcion && <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{contenido.descripcion}</p>}
        {contenido.credito && <p className="mt-2 text-[10px] text-slate-400">Crédito: {contenido.credito}</p>}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => toggleActivo(contenido)}
            disabled={actingId === contenido.id}
            title={contenido.activo ? "Ocultar de la web" : "Mostrar en la web"}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
          >
            {actingId === contenido.id ? <Loader2 size={12} className="animate-spin" /> : contenido.activo ? <EyeOff size={12} /> : <Eye size={12} />}
            {contenido.activo ? "Ocultar" : "Mostrar"}
          </button>
          <button
            onClick={() => eliminar(contenido.id)}
            disabled={actingId === contenido.id}
            title="Eliminar"
            className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 transition-all disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  if (checkingSession) return (
    <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-[#E31E24]" size={36} /></div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {msg && <div className="p-4 bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 text-sm font-bold rounded-r-xl flex items-center gap-2"><CheckCircle2 size={16} />{msg}</div>}
      {err && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700 text-sm font-bold rounded-r-xl flex items-center justify-between gap-4">
          <span>{err}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 underline underline-offset-2"
          >
            Reintentar
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => cambiarCategoria("viajes")}
          disabled={subiendo || guardando}
          aria-pressed={categoria === "viajes"}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-black uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${categoria === "viajes" ? "border-[#E31E24] text-[#E31E24]" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Images size={16} /> Fotos y videos de viajes
        </button>
        <button
          type="button"
          onClick={() => cambiarCategoria("destinos")}
          disabled={subiendo || guardando}
          aria-pressed={categoria === "destinos"}
          className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-black uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${categoria === "destinos" ? "border-[#E31E24] text-[#E31E24]" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <MapPin size={16} /> Destinos
        </button>
      </div>

      {/* AYUDA */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex items-start gap-3">
        <div className="bg-[#E31E24]/10 p-2 rounded-xl shrink-0">{categoria === "destinos" ? <MapPin size={20} className="text-[#E31E24]" /> : <Images size={20} className="text-[#E31E24]" />}</div>
        {categoria === "destinos" ? (
          <p className="text-sm text-slate-600 font-medium leading-relaxed">
            Las fotos de esta sección se muestran en <span className="font-black italic">&ldquo;Destinos&rdquo;</span> en la página principal. Agrega el nombre y, si corresponde, los datos del crédito de la imagen. Puedes ocultarlas o eliminarlas.
          </p>
        ) : (
          <p className="text-sm text-slate-600 font-medium leading-relaxed">
            Las fotos y videos que subas aquí aparecen en la sección de viajes de la página principal. La portada del video se toma de su primer fotograma y su orientación original se conserva automáticamente. Puedes ocultarlos sin borrarlos con el botón de visibilidad.
          </p>
        )}
      </div>

      {/* SUBIR NUEVO CONTENIDO */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Agregar {categoria === "destinos" ? "foto de destino" : "contenido de viaje"}</p>
          {categoria === "viajes" && (
            <div className="flex rounded-xl border border-slate-200 p-1 bg-slate-50">
              <button type="button" onClick={() => { posterRequestRef.current += 1; setTipoContenido("imagen"); setImagenUrl(""); setImagePreviewUrl(null); setVideoPreview(null); setSelectedVideo(null); setVideoPosterPreview(null); setVideoPosterBlob(null); setVideoPosterUrl(""); setVideoFormat("original"); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${tipoContenido === "imagen" ? "bg-white text-[#E31E24] shadow-sm" : "text-slate-400"}`}>Foto</button>
              <button type="button" onClick={() => { posterRequestRef.current += 1; setTipoContenido("video"); setImagenUrl(""); setImagePreviewUrl(null); setVideoPreview(null); setSelectedVideo(null); setVideoPosterPreview(null); setVideoPosterBlob(null); setVideoPosterUrl(""); setVideoFormat("original"); }} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase ${tipoContenido === "video" ? "bg-white text-[#E31E24] shadow-sm" : "text-slate-400"}`}>Video</button>
            </div>
          )}
        </div>
        <div className="grid md:grid-cols-[240px_1fr] gap-5">
          {/* Zona de subida */}
          <div>
            <input ref={fileRef} type="file" accept={tipoContenido === "video" ? "video/mp4,video/webm,video/quicktime" : "image/jpeg,image/png,image/webp"} className="hidden" onChange={(e) => tipoContenido === "video" ? selectVideo(e.target.files?.[0] || null) : handleFile(e.target.files?.[0] || null)} />
            {tipoContenido === "video" && videoPreview ? (
              <div
                className="relative mx-auto flex aspect-video max-h-[360px] w-full max-w-full items-center justify-center overflow-hidden rounded-2xl bg-slate-950"
              >
              {videoPosterPreview && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center opacity-60 blur-2xl"
                  style={{ backgroundImage: `url("${videoPosterPreview}")` }}
                />
              )}
              <video
                src={videoPreview}
                poster={videoPosterPreview || undefined}
                controls
                preload={videoPosterPreview ? "metadata" : "auto"}
                onLoadedMetadata={(event) => {
                  const { videoWidth, videoHeight } = event.currentTarget;
                  if (videoWidth > 0 && videoHeight > 0) setVideoOriginalAspectRatio(videoWidth / videoHeight);
                }}
                style={{
                  aspectRatio: previewAspectRatio,
                  width: previewAspectRatio < 1 ? "auto" : "100%",
                  height: previewAspectRatio < 1 ? "100%" : "auto",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  transform: `translate(${videoOffsetX}%, ${videoOffsetY}%) scale(${videoZoom / 100})`,
                }}
                  className="relative z-10 max-h-full max-w-full bg-transparent"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 transition-all hover:border-[#E31E24] hover:bg-red-50/40"
              >
              {imagePreviewUrl ? (
                <>
                  <Image src={imagePreviewUrl} alt="Vista previa de la foto seleccionada" fill sizes="240px" unoptimized className="object-cover" />
                  {subiendo && <span className="absolute inset-0 flex items-center justify-center bg-slate-950/35"><Loader2 className="animate-spin text-white" size={28} /></span>}
                </>
              ) : subiendo ? (
                <Loader2 className="animate-spin text-[#E31E24]" size={26} />
              ) : (
                <>
                  <UploadCloud className="text-slate-300" size={30} />
                  <span className="text-xs font-bold text-slate-400">Haz clic para cargar</span>
                  <span className="text-[10px] text-slate-300">{tipoContenido === "video" ? "MP4, WEBM o MOV · máx 100MB" : "JPG, PNG o WEBP · máx 5MB"}</span>
                </>
              )}
              </button>
            )}
            {tipoContenido === "video" && videoPreview && (
              <div className="mt-4 space-y-3">
                <fieldset className="space-y-2">
                  <legend className="text-[10px] font-black uppercase tracking-widest text-slate-500">Formato de visualización</legend>
                  <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                    {([
                      ["original", "Automático"],
                      ["horizontal", "Horizontal"],
                      ["vertical", "Vertical"],
                    ] as const).map(([format, label]) => (
                      <button
                        key={format}
                        type="button"
                        aria-pressed={videoFormat === format}
                        onClick={() => setVideoFormat(format)}
                        className={`rounded-lg px-2 py-2 text-[9px] font-black uppercase transition-colors ${videoFormat === format ? "bg-white text-[#E31E24] shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={subiendo || guardando} className="text-[11px] font-bold text-slate-500 hover:text-[#E31E24] disabled:opacity-50">
                  Elegir otro video
                </button>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Mover horizontal · {videoOffsetX}%
                  <input type="range" min="-25" max="25" value={videoOffsetX} onChange={(event) => setVideoOffsetX(Number(event.target.value))} className="mt-1 w-full accent-[#E31E24]" />
                </label>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Mover vertical · {videoOffsetY}%
                  <input type="range" min="-25" max="25" value={videoOffsetY} onChange={(event) => setVideoOffsetY(Number(event.target.value))} className="mt-1 w-full accent-[#E31E24]" />
                </label>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Zoom · {videoZoom}%
                  <input type="range" min="100" max="160" value={videoZoom} onChange={(event) => setVideoZoom(Number(event.target.value))} className="mt-1 w-full accent-[#E31E24]" />
                </label>
                <p className="text-[10px] leading-relaxed text-slate-400">Se muestra el video completo; si el formato no coincide, quedarán márgenes. El archivo original no se modifica.</p>
                {!imagenUrl && (
                  <button type="button" onClick={handleUploadVideo} disabled={subiendo || !selectedVideo} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
                    {subiendo ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
                    Subir video
                  </button>
                )}
              </div>
            )}
            {(imagenUrl || imagePreviewUrl) && (
              <button type="button" onClick={() => { setImagenUrl(""); setImagePreviewUrl(null); if (fileRef.current) fileRef.current.value = ""; }} className="mt-2 text-[11px] font-bold text-slate-400 hover:text-[#E31E24] transition-colors">
                Quitar archivo
              </button>
            )}
          </div>

          {/* Datos */}
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Título (opcional)</label>
              <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120}
                placeholder="Ej: Tour a Los Frailes, Manabí"
                className="w-full px-4 py-2.5 rounded-xl border-2 border-slate-100 bg-slate-50 text-sm font-medium outline-none focus:border-[#E31E24] transition-all" />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Descripción (opcional)</label>
              <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={500} rows={3}
                placeholder="Una frase corta sobre el viaje..."
                className="w-full px-4 py-2.5 rounded-xl border-2 border-slate-100 bg-slate-50 text-sm font-medium outline-none focus:border-[#E31E24] transition-all resize-none" />
            </div>
            <button
              onClick={handleGuardar}
              disabled={guardando || subiendo || !imagenUrl}
              className="flex items-center gap-2 bg-[#E31E24] hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all shadow-lg shadow-red-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {guardando ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Publicar {tipoContenido === "video" ? "video" : "foto"}
            </button>
            {categoria === "destinos" && (
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-label="Previsualización del destino">
                <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-500">Vista previa publicada</p>
                <article className="mx-auto max-w-[320px] overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-lg">
                  <div className="relative aspect-[5/4] overflow-hidden bg-gray-200">
                    {imagePreviewUrl ? (
                      <Image
                        src={imagePreviewUrl}
                        alt={titulo.trim() || "Previsualización de la foto del destino"}
                        fill
                        sizes="320px"
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs font-medium text-slate-400">
                        Selecciona una foto para previsualizarla
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
                    {titulo.trim() && (
                      <h3 className="absolute inset-x-0 bottom-0 p-5 text-xl font-black italic tracking-tight text-white drop-shadow-md">
                        {titulo}
                      </h3>
                    )}
                  </div>
                  <div className="flex flex-col p-5">
                    {descripcion.trim() && <p className="text-sm font-medium leading-relaxed text-gray-600">{descripcion}</p>}
                    <span className="mt-5 inline-flex items-center gap-1 text-xs font-black uppercase tracking-wider text-[#E31E24]">
                      Cotizar traslado <ArrowUpRight size={15} aria-hidden="true" />
                    </span>
                  </div>
                </article>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* GALERÍA ACTUAL */}
      <div>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[#E31E24]" size={30} /></div>
        ) : (
          <div className="space-y-6">
            {[
              { title: "Fotos", items: imagenes, Icon: Images },
              { title: "Videos", items: videos, Icon: Video },
            ].map(({ title, items, Icon }) => (
              <section key={title} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Icon size={17} className="text-[#E31E24]" />
                  <h2 className="text-[11px] font-black uppercase tracking-widest text-slate-600">{title}</h2>
                  <span className="text-[11px] font-black text-slate-300">· {items.length}</span>
                </div>
                {title === "Videos" && items.length > 1 && (
                  <p className="mb-4 text-xs font-medium text-slate-500">
                    Arrastra cada video desde <span className="font-bold">Mover</span>: el primero será grande a la izquierda y los dos siguientes irán apilados a la derecha.
                    {reorderingVideos && <span className="ml-2 text-[#E31E24]">Guardando orden...</span>}
                  </p>
                )}
                {items.length > 0 ? (
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {items.map((item, index) => renderContenido(item, index))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
                    <p className="text-xs font-bold text-slate-400">Aún no hay {title.toLowerCase()} publicadas.</p>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      {/* ZOOM */}
      {zoomImg && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setZoomImg(null)}>
          <button className="absolute top-5 right-5 text-white/70 hover:text-white transition-colors" onClick={() => setZoomImg(null)}><X size={28} /></button>
          <Image src={zoomImg} alt="Foto de viaje" width={1200} height={900} unoptimized className="max-w-full max-h-full object-contain rounded-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
