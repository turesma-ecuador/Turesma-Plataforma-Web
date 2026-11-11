"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import { CheckCircle2, ImagePlus, Loader2, Move, RotateCcw, Save, UploadCloud, XCircle } from "lucide-react";
import { useAdminGuard } from "../../../lib/use-admin-guard";
import { getAuthHeaders, handleUnauthorized } from "../../../lib/session";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const SLOTS = ["primary", "secondary"] as const;
type Slot = (typeof SLOTS)[number];
type CropSettings = { positionX: number; positionY: number; zoom: number };
type HomeShowcaseImages = Record<Slot, string | null>;
type HomeShowcaseData = Record<Slot, {
  image_url: string;
  position_x: number;
  position_y: number;
  zoom: number;
} | null>;
type CityShowcase = {
  primary_image_url: string;
  secondary_image_url: string;
  primary_alt: string;
  secondary_alt: string;
  eyebrow: string;
  title: string;
  description: string;
  label: string;
};

const slotInfo: Record<Slot, { title: string; description: string; shape: string }> = {
  primary: {
    title: "Imagen principal",
    description: "La foto grande que aparece en el bloque «Tu viaje, a tu medida».",
    shape: "aspect-[0.84] w-[72%] max-w-[220px] rounded-[48%_48%_38%_38%]",
  },
  secondary: {
    title: "Imagen secundaria",
    description: "La foto pequeña que acompaña a la imagen principal.",
    shape: "aspect-[1.24] w-[92%] max-w-[300px] rounded-[46%_46%_30%_30%]",
  },
};

const emptyImages: HomeShowcaseImages = { primary: null, secondary: null };
const defaultCrop: CropSettings = { positionX: 50, positionY: 50, zoom: 100 };
const fallbackImages: Record<Slot, string> = {
  primary: "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?q=80&w=2069&auto=format&fit=crop",
  secondary: "/destinos/puerto-lopez.jpg",
};
const defaultCityShowcase: CityShowcase = {
  primary_image_url: "/manta-city.jpg",
  secondary_image_url: "/manta-flag.png",
  primary_alt: "Vista de la costa y la ciudad de Manta, Ecuador",
  secondary_alt: "Bandera y escudo de Manta frente a la costa de la ciudad",
  eyebrow: "Desde Manta para el Ecuador",
  title: "Una empresa que conecta personas, destinos y experiencias en todo el Ecuador.",
  description: "En TURESMA S.A. redefinimos el transporte turístico con un compromiso inquebrantable con la seguridad y la elegancia. Nuestra operación nace en Manta y acompaña cada recorrido con servicio, comodidad y confianza.",
  label: "Servicio turístico, ejecutivo y empresarial",
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function ShowcasePreviewImage({
  src,
  alt,
  style,
  draggable,
}: {
  src: string;
  alt: string;
  style: CSSProperties;
  draggable?: boolean;
}) {
  if (src.startsWith("blob:")) {
    // Browser-local previews should bypass Next image handling until uploaded.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} draggable={draggable} className="absolute inset-0 h-full w-full object-cover" style={style} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      draggable={draggable}
      className="object-cover"
      style={style}
    />
  );
}

export default function AdminImagenesPortadaPage() {
  const { checkingSession } = useAdminGuard();
  const [images, setImages] = useState<HomeShowcaseImages>(emptyImages);
  const [settings, setSettings] = useState<Record<Slot, CropSettings>>({
    primary: defaultCrop,
    secondary: defaultCrop,
  });
  const [savedSettings, setSavedSettings] = useState<Record<Slot, CropSettings>>({
    primary: defaultCrop,
    secondary: defaultCrop,
  });
  const [selectedFiles, setSelectedFiles] = useState<Record<Slot, File | null>>({
    primary: null,
    secondary: null,
  });
  const [previews, setPreviews] = useState<Record<Slot, string | null>>(emptyImages);
  const [loading, setLoading] = useState(true);
  const [savingSlot, setSavingSlot] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cityShowcase, setCityShowcase] = useState<CityShowcase>(defaultCityShowcase);
  const [cityFiles, setCityFiles] = useState<{ primary: File | null; secondary: File | null }>({ primary: null, secondary: null });
  const [cityPreviews, setCityPreviews] = useState<{ primary: string | null; secondary: string | null }>({ primary: null, secondary: null });
  const [savingCity, setSavingCity] = useState(false);
  const previewUrls = useRef<Record<Slot, string | null>>({ primary: null, secondary: null });
  const filePickerScrollPosition = useRef<{ main: number; section: number } | null>(null);
  const dragStart = useRef<{
    slot: Slot;
    pointerX: number;
    pointerY: number;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (checkingSession) return;
    let isCurrent = true;

    fetch(`${API}/api/admin/home-showcase-images`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (response) => {
        if (handleUnauthorized(response.status)) return null;
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "No se pudieron cargar las imágenes");
        return data;
      })
      .then((data: unknown) => {
        if (!isCurrent || !data || typeof data !== "object") return;
        const result = data as Partial<HomeShowcaseData>;
        const loadedImages: HomeShowcaseImages = { primary: null, secondary: null };
        const loadedSettings: Record<Slot, CropSettings> = {
          primary: { ...defaultCrop },
          secondary: { ...defaultCrop },
        };
        for (const slot of SLOTS) {
          const entry = result[slot];
          if (!entry || typeof entry.image_url !== "string") continue;
          loadedImages[slot] = entry.image_url;
          loadedSettings[slot] = {
            positionX: Number.isFinite(Number(entry.position_x)) ? Number(entry.position_x) : 50,
            positionY: Number.isFinite(Number(entry.position_y)) ? Number(entry.position_y) : 50,
            zoom: Number.isFinite(Number(entry.zoom)) ? Number(entry.zoom) : 100,
          };
        }
        setImages({
          ...loadedImages,
        });
        setSettings(loadedSettings);
        setSavedSettings(loadedSettings);
      })
      .catch((loadError: unknown) => {
        if (!isCurrent) return;
        const message = loadError instanceof DOMException && loadError.name === "TimeoutError"
          ? "El servidor tardó demasiado en responder. Comprueba que el backend esté iniciado e inténtalo de nuevo."
          : loadError instanceof Error
            ? loadError.message
            : "No se pudieron cargar las imágenes";
        setError(message);
      })
      .finally(() => {
        if (isCurrent) setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [checkingSession]);

  useEffect(() => {
    if (checkingSession) return;
    fetch(`${API}/api/admin/home-city-showcase`, {
      headers: getAuthHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (response) => {
        if (handleUnauthorized(response.status)) return null;
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "No se pudo cargar la presentación de Manta");
        return data as CityShowcase;
      })
      .then((data) => {
        if (data) setCityShowcase((current) => ({ ...current, ...data }));
      })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la presentación de Manta"));
  }, [checkingSession]);

  useEffect(() => {
    const urls = previewUrls.current;
    return () => {
      for (const slot of SLOTS) {
        const url = urls[slot];
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, []);

  const selectImage = (slot: Slot, file: File | null) => {
    if (loading) return;
    setError("");
    setMessage("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Formato no válido. Selecciona una imagen JPG, PNG o WEBP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("La imagen supera el límite de 5 MB.");
      return;
    }
    try {
      const previewUrl = URL.createObjectURL(file);
      const previousUrl = previewUrls.current[slot];
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      previewUrls.current[slot] = previewUrl;
      setPreviews((current) => ({ ...current, [slot]: previewUrl }));
      setSelectedFiles((current) => ({ ...current, [slot]: file }));
    } catch {
      setError("No se pudo preparar la vista previa. Prueba con otro archivo JPG, PNG o WEBP.");
    }
  };

  const updateSettings = (slot: Slot, values: Partial<CropSettings>) => {
    if (loading) return;
    setError("");
    setMessage("");
    setSettings((current) => ({
      ...current,
      [slot]: { ...current[slot], ...values },
    }));
  };

  const startDragging = (slot: Slot, event: ReactPointerEvent<HTMLDivElement>) => {
    if (loading || savingSlot !== null) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      slot,
      pointerX: event.clientX,
      pointerY: event.clientY,
      positionX: settings[slot].positionX,
      positionY: settings[slot].positionY,
      width: bounds.width,
      height: bounds.height,
    };
  };

  const dragImage = (slot: Slot, event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.slot !== slot) return;
    updateSettings(slot, {
      positionX: clamp(start.positionX - ((event.clientX - start.pointerX) / start.width) * 100, 0, 100),
      positionY: clamp(start.positionY - ((event.clientY - start.pointerY) / start.height) * 100, 0, 100),
    });
  };

  const stopDragging = () => {
    dragStart.current = null;
  };

  const isDirty = (slot: Slot) => {
    const current = settings[slot];
    const saved = savedSettings[slot];
    return current.positionX !== saved.positionX
      || current.positionY !== saved.positionY
      || current.zoom !== saved.zoom;
  };

  const saveImage = async (slot: Slot) => {
    const file = selectedFiles[slot];
    if (!file && !isDirty(slot)) return;

    setSavingSlot(slot);
    setError("");
    setMessage("");
    try {
      let imageUrl = images[slot] || fallbackImages[slot] || "";
      if (file) {
        const formData = new FormData();
        formData.append("imagen", file);
        const authorization = getAuthHeaders().Authorization;
        const uploadResponse = await fetch(`${API}/api/admin/uploads/galeria-imagen`, {
          method: "POST",
          headers: authorization ? { Authorization: authorization } : {},
          body: formData,
        });
        if (handleUnauthorized(uploadResponse.status)) return;
        const uploadData = await uploadResponse.json().catch(() => null);
        if (!uploadResponse.ok || typeof uploadData?.imageUrl !== "string") {
          throw new Error(uploadData?.error || "No se pudo subir la imagen");
        }
        imageUrl = uploadData.imageUrl;
      }

      const saveResponse = await fetch(`${API}/api/admin/home-showcase-images/${slot}`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          position_x: settings[slot].positionX,
          position_y: settings[slot].positionY,
          zoom: settings[slot].zoom,
        }),
      });
      if (handleUnauthorized(saveResponse.status)) return;
      const saveData = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) throw new Error(saveData?.error || "No se pudo guardar la imagen");

      setImages((current) => ({ ...current, [slot]: saveData.image_url }));
      setSavedSettings((current) => ({ ...current, [slot]: { ...settings[slot] } }));
      setSelectedFiles((current) => ({ ...current, [slot]: null }));
      const previewUrl = previewUrls.current[slot];
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrls.current[slot] = null;
      setPreviews((current) => ({ ...current, [slot]: null }));
      setMessage(`${slotInfo[slot].title} actualizada correctamente.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la imagen");
    } finally {
      setSavingSlot(null);
    }
  };

  const selectCityImage = (slot: "primary" | "secondary", file: File | null) => {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Selecciona una imagen JPG, PNG o WEBP de máximo 5 MB.");
      return;
    }
    const preview = URL.createObjectURL(file);
    setCityFiles((current) => ({ ...current, [slot]: file }));
    setCityPreviews((current) => ({ ...current, [slot]: preview }));
  };

  const saveCityShowcase = async () => {
    setSavingCity(true);
    setError("");
    setMessage("");
    try {
      const values = { ...cityShowcase };
      for (const slot of ["primary", "secondary"] as const) {
        const file = cityFiles[slot];
        if (!file) continue;
        const formData = new FormData();
        formData.append("imagen", file);
        const uploadResponse = await fetch(`${API}/api/admin/uploads/galeria-imagen`, {
          method: "POST",
          headers: getAuthHeaders().Authorization ? { Authorization: getAuthHeaders().Authorization } : {},
          body: formData,
        });
        if (handleUnauthorized(uploadResponse.status)) return;
        const uploadData = await uploadResponse.json().catch(() => null);
        if (!uploadResponse.ok || typeof uploadData?.imageUrl !== "string") throw new Error(uploadData?.error || "No se pudo subir la imagen");
        values[slot === "primary" ? "primary_image_url" : "secondary_image_url"] = uploadData.imageUrl;
      }
      const response = await fetch(`${API}/api/admin/home-city-showcase`, {
        method: "PUT",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (handleUnauthorized(response.status)) return;
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "No se pudo guardar la presentación de Manta");
      setCityShowcase(data);
      setCityFiles({ primary: null, secondary: null });
      setCityPreviews({ primary: null, secondary: null });
      setMessage("Presentación de Manta actualizada correctamente.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la presentación de Manta");
    } finally {
      setSavingCity(false);
    }
  };

  if (checkingSession) {
    return (
      <div role="status" className="flex h-64 items-center justify-center gap-3 text-sm font-semibold text-slate-600">
        <Loader2 className="animate-spin text-[#E31E24]" size={24} />
        Comprobando sesión...
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-[#E31E24]">
            <ImagePlus size={24} />
          </span>
          <div>
            <h1 className="text-xl font-black text-slate-900 sm:text-2xl">Imágenes de portada</h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
              Administra por separado las dos fotos del bloque «Tu viaje, a tu medida». Estos cambios no modifican las fotos de los vehículos ni la galería web.
            </p>
          </div>
        </div>
      </header>

      {message && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
          <CheckCircle2 size={17} /> {message}
        </div>
      )}
      {loading && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-700">
          <Loader2 size={17} className="animate-spin" /> Cargando la configuración de las imágenes...
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          <XCircle size={17} /> {error}
        </div>
      )}

      <section className="order-4 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <h2 className="text-lg font-black text-slate-900">Presentación de Manta</h2>
          <p className="mt-1 text-sm text-slate-500">Administra las imágenes y el texto del bloque «Sobre nosotros» de la página pública.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {(["primary", "secondary"] as const).map((slot) => {
            const imageKey = slot === "primary" ? "primary_image_url" : "secondary_image_url";
            const altKey = slot === "primary" ? "primary_alt" : "secondary_alt";
            return (
              <div key={slot} className="space-y-3 rounded-xl bg-slate-50 p-4">
                <div className="relative h-40 overflow-hidden rounded-xl bg-slate-200">
                  <img src={cityPreviews[slot] || cityShowcase[imageKey]} alt={cityShowcase[altKey]} className="h-full w-full object-cover" />
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                  <UploadCloud size={15} /> Cambiar imagen
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => selectCityImage(slot, event.target.files?.[0] || null)} />
                </label>
                <label className="block text-xs font-bold text-slate-600">
                  Texto alternativo
                  <input value={cityShowcase[altKey]} onChange={(event) => setCityShowcase((current) => ({ ...current, [altKey]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800" />
                </label>
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {([
            ["eyebrow", "Texto superior"],
            ["label", "Etiqueta de servicios"],
            ["title", "Título"],
            ["description", "Descripción"],
          ] as const).map(([key, label]) => (
            <label key={key} className={`block text-xs font-bold text-slate-600 ${key === "title" || key === "description" ? "md:col-span-2" : ""}`}>
              {label}
              {key === "description" ? (
                <textarea value={cityShowcase[key]} onChange={(event) => setCityShowcase((current) => ({ ...current, [key]: event.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800" />
              ) : (
                <input value={cityShowcase[key]} onChange={(event) => setCityShowcase((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-800" />
              )}
            </label>
          ))}
        </div>
        <button type="button" onClick={saveCityShowcase} disabled={loading || savingCity} className="inline-flex items-center gap-2 rounded-xl bg-[#E31E24] px-4 py-2.5 text-xs font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
          {savingCity ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {savingCity ? "Guardando..." : "Guardar presentación de Manta"}
        </button>
      </section>

      <section className="order-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-800">Vista previa en la portada</h2>
          <p className="mt-1 text-xs text-slate-500">Así se verán las fotos en el bloque de inicio mientras ajustas el encuadre.</p>
        </div>
        <div className="flex min-h-[300px] items-center justify-center overflow-hidden rounded-xl bg-[#f7f8fa] p-5">
          <div className="relative h-[260px] w-full max-w-[300px]">
            {SLOTS.map((slot) => {
              const source = previews[slot] || images[slot] || fallbackImages[slot];
              const crop = settings[slot];
              return (
                <div
                  key={slot}
                  className={`absolute overflow-hidden bg-slate-200 shadow-xl ${
                    slot === "primary"
                      ? "left-[3%] top-0 h-[88%] w-[68%] rounded-[48%_48%_38%_38%]"
                      : "bottom-[2%] right-[2%] h-[48%] w-[55%] rounded-[46%_46%_30%_30%] border-[5px] border-[#f7f8fa]"
                  }`}
                >
                  <ShowcasePreviewImage
                    src={source}
                    alt={`Vista previa ${slotInfo[slot].title.toLowerCase()}`}
                    style={{
                      objectPosition: `${crop.positionX}% ${crop.positionY}%`,
                      transform: `scale(${crop.zoom / 100})`,
                    }}
                  />
                </div>
              );
            })}
            <div className="absolute right-[5%] top-[25%] flex h-10 w-10 rotate-12 items-center justify-center rounded-full bg-[#E31E24] text-2xl font-black text-white shadow-lg" aria-hidden="true">*</div>
            <div className="absolute bottom-[5%] left-[5%] flex items-center gap-1.5 rounded-xl border border-white bg-white/95 px-2.5 py-2 shadow-lg">
              <span className="text-[9px] font-black uppercase tracking-wide text-gray-800">Flota TURESMA</span>
            </div>
          </div>
        </div>
      </section>

      <div className="order-3 grid gap-5 md:grid-cols-2">
        {SLOTS.map((slot) => {
          const currentPreview = previews[slot] || images[slot];
          const source = currentPreview || fallbackImages[slot];
          const saving = savingSlot === slot;
          const crop = settings[slot];
          const dirty = isDirty(slot);
          const hasChanges = Boolean(selectedFiles[slot]) || dirty;
          return (
            <section key={slot} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex min-h-[300px] items-center justify-center bg-slate-100 p-6">
                <div
                  className={`relative cursor-grab touch-none select-none overflow-hidden bg-slate-200 shadow-xl active:cursor-grabbing ${slotInfo[slot].shape}`}
                  onPointerDown={(event) => startDragging(slot, event)}
                  onPointerMove={(event) => dragImage(slot, event)}
                  onPointerUp={stopDragging}
                  onPointerCancel={stopDragging}
                  aria-label={`Arrastra para ajustar el encuadre de ${slotInfo[slot].title.toLowerCase()}`}
                  title="Arrastra la imagen para mover el encuadre"
                >
                  <ShowcasePreviewImage
                    src={source}
                    alt={slotInfo[slot].title}
                    draggable={false}
                    style={{
                      objectPosition: `${crop.positionX}% ${crop.positionY}%`,
                      transform: `scale(${crop.zoom / 100})`,
                    }}
                  />
                  <span className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-950/70 px-3 py-1.5 text-[10px] font-bold text-white">
                    <Move size={12} /> Arrastra para mover
                  </span>
                  {(previews[slot] || dirty) && (
                    <span className="absolute left-3 top-3 rounded-full bg-slate-950/75 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                      Vista previa
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-4 p-5">
                <div>
                  <h2 className="text-base font-black text-slate-900">{slotInfo[slot].title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{slotInfo[slot].description}</p>
                </div>
                <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${slot}-zoom`} className="text-xs font-bold text-slate-700">Acercamiento</label>
                    <span className="text-xs font-black tabular-nums text-[#E31E24]">{crop.zoom}%</span>
                  </div>
                  <input
                    id={`${slot}-zoom`}
                    type="range"
                    min="100"
                    max="200"
                    step="1"
                    value={crop.zoom}
                    onChange={(event) => updateSettings(slot, { zoom: Number(event.target.value) })}
                    disabled={loading || savingSlot !== null}
                    className="w-full accent-[#E31E24]"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400">Alejar</span>
                    <button
                      type="button"
                      onClick={() => updateSettings(slot, { ...defaultCrop })}
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 transition hover:text-[#E31E24]"
                    >
                      <RotateCcw size={12} /> Restablecer encuadre
                    </button>
                    <span className="text-[10px] text-slate-400">Acercar</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {([
                      ["Horizontal", "positionX"],
                      ["Vertical", "positionY"],
                    ] as const).map(([label, key]) => (
                      <label key={key} className="space-y-1 text-[10px] font-semibold text-slate-500">
                        <span className="flex justify-between"><span>{label}</span><span>{Math.round(crop[key])}%</span></span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={crop[key]}
                          onChange={(event) => updateSettings(slot, { [key]: Number(event.target.value) })}
                          disabled={loading || savingSlot !== null}
                          className="w-full accent-[#E31E24]"
                          aria-label={`Ajuste ${label.toLowerCase()} ${slotInfo[slot].title.toLowerCase()}`}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 transition hover:border-[#E31E24] hover:text-[#E31E24]">
                    <UploadCloud size={16} />
                    Elegir imagen
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={loading || savingSlot !== null}
                      onClick={(event) => {
                        const main = event.currentTarget.closest("main");
                        const section = main?.querySelector("section");
                        if (main && section) {
                          filePickerScrollPosition.current = {
                            main: main.scrollTop,
                            section: section.scrollTop,
                          };
                        }
                      }}
                      onChange={(event) => {
                        const input = event.currentTarget;
                        selectImage(slot, input.files?.[0] || null);
                        input.value = "";
                        const previousScroll = filePickerScrollPosition.current;
                        filePickerScrollPosition.current = null;
                        if (!previousScroll) return;
                        const restoreScroll = () => {
                          const main = input.closest("main");
                          const section = main?.querySelector("section");
                          if (!main || !section) return;
                          main.scrollTop = previousScroll.main;
                          section.scrollTop = previousScroll.section;
                        };
                        requestAnimationFrame(() => {
                          restoreScroll();
                          requestAnimationFrame(restoreScroll);
                        });
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => saveImage(slot)}
                    disabled={loading || !hasChanges || savingSlot !== null}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#E31E24] px-4 py-2.5 text-xs font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    {saving ? "Guardando..." : selectedFiles[slot] ? "Guardar imagen y encuadre" : "Guardar encuadre"}
                  </button>
                </div>
                <p className="text-[11px] font-medium text-slate-400">JPG, PNG o WEBP · Máximo 5 MB</p>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
