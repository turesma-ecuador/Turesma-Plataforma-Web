"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, useRef, type MouseEvent, type SyntheticEvent } from "react";
import {
  BriefcaseBusiness,
  BadgeCheck,
  Clock3,
  Activity,
  Bus,
  ChevronRight,
  ChevronLeft,
  X,
  Menu as MenuIcon,
  Phone,
  Mail,
  MapPin,
  ShieldCheck,
  CalendarRange,
  Route,
  ArrowUpRight,
  UsersRound,
  SlidersHorizontal,
  PlayCircle,
  Play,
  Pause,
  Volume2,
  VolumeX
} from "lucide-react";
import { LanguageSwitcher, LocalizedContent } from "../lib/i18n";

type VehiculoPublico = {
  id: number;
  tipo: string | null;
  modelo: string | null;
  capacidad: number | null;
  color: string | null;
  imagen_url: string | null;
  descripcion: string | null;
  estado: string;
};

type GaleriaFoto = {
  id: number;
  imagen_url: string;
  tipo?: "imagen" | "video";
  categoria?: "viajes" | "destinos";
  video_offset_x?: number | null;
  video_offset_y?: number | null;
  video_zoom?: number | null;
  video_format?: "original" | "horizontal" | "vertical";
  video_aspect_ratio?: number | null;
  video_poster_url?: string | null;
  titulo: string | null;
  descripcion: string | null;
  credito?: string | null;
  fuente_url?: string | null;
  licencia?: string | null;
  licencia_url?: string | null;
};

type HomeCityShowcase = {
  primary_image_url: string;
  secondary_image_url: string;
  primary_alt: string;
  secondary_alt: string;
  primary_position_x: number;
  primary_position_y: number;
  primary_zoom: number;
  secondary_position_x: number;
  secondary_position_y: number;
  secondary_zoom: number;
  eyebrow: string;
  title: string;
  description: string;
  label: string;
};

const getVideoAspectRatio = (video: GaleriaFoto) => (
  video.video_format === "vertical"
    ? 9 / 16
    : video.video_format === "horizontal"
      ? 16 / 9
      : video.video_aspect_ratio || 16 / 9
);

const createVideoMosaics = (videos: GaleriaFoto[]) => {
  const mosaics: GaleriaFoto[][] = [];
  let index = 0;

  while (index < videos.length) {
    const nextFour = videos.slice(index, index + 4);
    const portraitCount = nextFour.filter((video) => getVideoAspectRatio(video) < 1).length;
    const mosaicSize = nextFour.length === 4 && portraitCount === 2 ? 4 : Math.min(3, videos.length - index);
    mosaics.push(videos.slice(index, index + mosaicSize));
    index += mosaicSize;
  }

  return mosaics;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const HERO_IMAGE_URL = "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?q=80&w=2069&auto=format&fit=crop";

// Número oficial de la empresa (formato internacional sin +). Cambiarlo aquí
// actualiza el botón flotante, el CTA del hero y el pie de página a la vez.
const TELEFONO_EMPRESA = "593993570061";
const TELEFONO_EMPRESA_DISPLAY = "+593 99 357 0061";

const IMAGEN_FALLBACK = "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?q=80&w=800&auto=format&fit=crop";
const PUBLIC_DATA_CACHE_KEY = "turesma_public_data";

const getSafeImageSource = (source?: string | null) => {
  if (!source) return IMAGEN_FALLBACK;
  try {
    const hostname = new URL(source, "http://localhost").hostname.toLowerCase();
    if (hostname === "supabase.co" || hostname.endsWith(".supabase.co")) return IMAGEN_FALLBACK;
  } catch {
    return IMAGEN_FALLBACK;
  }
  return source;
};

const handleRemoteImageError = (event: SyntheticEvent<HTMLImageElement>) => {
  const image = event.currentTarget;
  if (image.src === IMAGEN_FALLBACK) return;
  image.onerror = null;
  image.src = IMAGEN_FALLBACK;
  image.srcset = "";
};

type PublicDataCache = {
  vehiculos: VehiculoPublico[];
  galeria: GaleriaFoto[];
};

type HomeShowcaseImage = {
  image_url: string | null;
  position_x: number;
  position_y: number;
  zoom: number;
};

type HomeShowcaseImages = {
  primary: HomeShowcaseImage | null;
  secondary: HomeShowcaseImage | null;
};

function VideoPlayer({ src, posterUrl, title, offsetX, offsetY, zoom, videoFormat, aspectRatio, className }: { src: string; posterUrl?: string | null; title: string | null; offsetX?: number | null; offsetY?: number | null; zoom?: number | null; videoFormat?: "original" | "horizontal" | "vertical"; aspectRatio?: number | null; className?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [loadPreview, setLoadPreview] = useState(false);
  const [useNativeControls, setUseNativeControls] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [detectedAspectRatio, setDetectedAspectRatio] = useState<number | null>(null);
  const displayAspectRatio = videoFormat === "vertical"
    ? 9 / 16
    : videoFormat === "horizontal"
      ? 16 / 9
      : detectedAspectRatio || aspectRatio || 16 / 9;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!("IntersectionObserver" in window)) {
      setLoadPreview(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoadPreview(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      try {
        await video.play();
        setPlaybackError("");
      } catch (error) {
        console.error("No se pudo reproducir el video:", error);
        setPlaybackError("No se pudo iniciar este video. Prueba con los controles del reproductor.");
        setUseNativeControls(true);
      }
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  return (
    <LocalizedContent>
    <div
      className={`video-player group/video relative flex items-center justify-center overflow-hidden bg-slate-950 ${className || "mx-auto max-h-[420px] max-w-full"}`}
      style={{ aspectRatio: displayAspectRatio }}
    >
      {posterUrl && (
        <Image
          src={getSafeImageSource(posterUrl)}
          alt="Fondo difuminado de la vista previa del video"
          aria-hidden="true"
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          unoptimized
          className="pointer-events-none scale-110 object-cover opacity-60 blur-2xl"
        />
      )}
      <video
        ref={videoRef}
        src={src}
        poster={posterUrl || undefined}
        preload={loadPreview ? (posterUrl ? "metadata" : "auto") : "none"}
        controls={useNativeControls}
        playsInline
        disablePictureInPicture
        controlsList="nodownload noplaybackrate noremoteplayback"
        aria-label={title || "Video de Turesma"}
        style={{
          aspectRatio: displayAspectRatio,
          width: displayAspectRatio < 1 ? "auto" : "100%",
          height: displayAspectRatio < 1 ? "100%" : "auto",
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          transform: `translate(${offsetX || 0}%, ${offsetY || 0}%) scale(${(zoom || 100) / 100})`,
        }}
        onLoadedMetadata={(event) => {
          const { videoWidth, videoHeight } = event.currentTarget;
          if (videoWidth > 0 && videoHeight > 0) setDetectedAspectRatio(videoWidth / videoHeight);
        }}
        onPlay={() => {
          setIsPlaying(true);
          setPlaybackError("");
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onError={(event) => {
          const mediaError = event.currentTarget.error;
          console.error("Error cargando el video:", mediaError);
          setPlaybackError("Este video no pudo cargarse en el navegador. Intenta abrirlo directamente.");
          setUseNativeControls(true);
        }}
        onVolumeChange={(event) => setIsMuted(event.currentTarget.muted)}
        onContextMenu={(event) => event.preventDefault()}
        className="relative z-10 bg-transparent"
      />
      {!useNativeControls && (
      <div className="video-player-controls absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pb-4 pt-10">
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={isPlaying ? "Pausar video" : "Reproducir video"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={isMuted ? "Activar sonido" : "Silenciar video"}
          aria-pressed={!isMuted}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
      </div>
      )}
      {playbackError && (
        <div role="alert" className="absolute inset-x-3 top-3 z-30 rounded-xl bg-slate-950/90 p-3 text-center text-xs font-semibold text-white shadow-lg">
          <p>{playbackError}</p>
          <a href={src} target="_blank" rel="noreferrer" className="mt-1 inline-block underline underline-offset-2">
            Abrir video
          </a>
        </div>
      )}
    </div>
    </LocalizedContent>
  );
}

export default function RootPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [vehiculos, setVehiculos] = useState<VehiculoPublico[]>([]);
  const [loadingVehiculos, setLoadingVehiculos] = useState(true);
  const [galeria, setGaleria] = useState<GaleriaFoto[]>([]);
  const [homeShowcaseImages, setHomeShowcaseImages] = useState<HomeShowcaseImages>({
    primary: null,
    secondary: null,
  });
  const [homeCityShowcase, setHomeCityShowcase] = useState<HomeCityShowcase | null>(null);
  const [shouldLoadGallery, setShouldLoadGallery] = useState(false);
  const flotaRef = useRef<HTMLDivElement | null>(null);
  const galleryTriggerRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuWasOpen = useRef(false);
  const publicDataCacheRef = useRef<PublicDataCache>({ vehiculos: [], galeria: [] });
  const fotosGaleria = galeria.filter((contenido) => contenido.categoria !== "destinos" && contenido.tipo !== "video");
  const videosGaleria = galeria.filter((contenido) => contenido.categoria !== "destinos" && contenido.tipo === "video");
  const imagenPrincipal = getSafeImageSource(homeShowcaseImages.primary?.image_url || HERO_IMAGE_URL);
  const imagenSecundaria = getSafeImageSource(homeShowcaseImages.secondary?.image_url || "/destinos/puerto-lopez.jpg");
  const cityShowcase = homeCityShowcase || {
    primary_image_url: "/manta-city.jpg",
    secondary_image_url: "/manta-flag.png",
    primary_alt: "Vista de la costa y la ciudad de Manta, Ecuador",
    secondary_alt: "Bandera y escudo de Manta frente a la costa de la ciudad",
    primary_position_x: 50,
    primary_position_y: 50,
    primary_zoom: 100,
    secondary_position_x: 50,
    secondary_position_y: 50,
    secondary_zoom: 100,
    eyebrow: "Desde Manta para el Ecuador",
    title: "Una empresa que conecta personas, destinos y experiencias en todo el Ecuador.",
    description: "En TURESMA S.A. redefinimos el transporte turístico con un compromiso inquebrantable con la seguridad y la elegancia. Nuestra operación nace en Manta y acompaña cada recorrido con servicio, comodidad y confianza.",
    label: "Servicio turístico, ejecutivo y empresarial",
  };
  const mosaicosVideos = createVideoMosaics(videosGaleria);
  const fotosDestinos = galeria.filter((contenido) => contenido.categoria === "destinos" && contenido.tipo !== "video");

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>('.home-page [data-reveal]');
    const iconCards = document.querySelectorAll<HTMLElement>('.home-page [data-icon-card]');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion) {
      elements.forEach((element) => element.classList.add('is-visible'));
      iconCards.forEach((element) => element.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    elements.forEach((element) => observer.observe(element));
    iconCards.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [fotosGaleria.length]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      if (mobileMenuWasOpen.current) mobileMenuTriggerRef.current?.focus();
      mobileMenuWasOpen.current = false;
      return;
    }

    mobileMenuWasOpen.current = true;
    mobileMenuRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
        mobileMenuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  // Desplaza el carrusel de flota una "tarjeta" a izq/der. Si ya está al final,
  // vuelve al inicio (loop infinito) para que el auto-avance no se detenga.
  const scrollFlota = (dir: "left" | "right") => {
    const el = flotaRef.current;
    if (!el) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const card = el.querySelector<HTMLElement>("[data-flota-card]");
    const amount = card ? card.offsetWidth + 24 : el.clientWidth * 0.8;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    const atStart = el.scrollLeft <= 4;

    if (dir === "right" && atEnd) {
      el.scrollTo({ left: 0, behavior });
    } else if (dir === "left" && atStart) {
      el.scrollTo({ left: el.scrollWidth, behavior });
    } else {
      el.scrollBy({ left: dir === "left" ? -amount : amount, behavior });
    }
  };

  useEffect(() => {
    let cachedVehicles: VehiculoPublico[] = [];
    let cachedGallery: GaleriaFoto[] = [];

    try {
      const cached = localStorage.getItem(PUBLIC_DATA_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached) as Partial<PublicDataCache>;
        if (Array.isArray(data.vehiculos)) {
          cachedVehicles = data.vehiculos;
          setVehiculos(cachedVehicles);
        }
        if (Array.isArray(data.galeria)) {
          cachedGallery = data.galeria;
        }
        if (Array.isArray(data.vehiculos)) setLoadingVehiculos(false);
      }
    } catch {
      localStorage.removeItem(PUBLIC_DATA_CACHE_KEY);
    }

    publicDataCacheRef.current = { vehiculos: cachedVehicles, galeria: cachedGallery };

    fetch(`${API_URL}/api/usuarios/vehiculos`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`No se pudo cargar la flota (${response.status})`);
        return response.json();
      })
      .then((data: unknown) => {
        if (!Array.isArray(data)) throw new Error("La respuesta de la flota no tiene un formato válido");
        cachedVehicles = data as VehiculoPublico[];
        publicDataCacheRef.current.vehiculos = cachedVehicles;
        setVehiculos(cachedVehicles);
        localStorage.setItem(PUBLIC_DATA_CACHE_KEY, JSON.stringify(publicDataCacheRef.current));
      })
      .catch((error: unknown) => {
        console.error("Error cargando los vehículos públicos:", error);
      })
      .finally(() => setLoadingVehiculos(false));
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/usuarios/home-city-showcase`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`No se pudo cargar la presentación de Manta (${response.status})`);
        return response.json();
      })
      .then((data: HomeCityShowcase) => setHomeCityShowcase(data))
      .catch((error: unknown) => console.error("Error cargando la presentación de Manta:", error));
  }, []);

  useEffect(() => {
    let isCurrent = true;
    fetch(`${API_URL}/api/usuarios/home-showcase-images`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`No se pudieron cargar las imágenes destacadas (${response.status})`);
        return response.json();
      })
      .then((data: unknown) => {
        if (!data || typeof data !== "object") throw new Error("La respuesta de imágenes destacadas no es válida");
        const images = data as Partial<HomeShowcaseImages>;
        if (!isCurrent) return;
        setHomeShowcaseImages({
          primary: images.primary && typeof images.primary.image_url === "string"
            ? {
                image_url: images.primary.image_url,
                position_x: Number.isFinite(images.primary.position_x) ? images.primary.position_x : 50,
                position_y: Number.isFinite(images.primary.position_y) ? images.primary.position_y : 50,
                zoom: Number.isFinite(images.primary.zoom) ? images.primary.zoom : 100,
              }
            : null,
          secondary: images.secondary && typeof images.secondary.image_url === "string"
            ? {
                image_url: images.secondary.image_url,
                position_x: Number.isFinite(images.secondary.position_x) ? images.secondary.position_x : 50,
                position_y: Number.isFinite(images.secondary.position_y) ? images.secondary.position_y : 50,
                zoom: Number.isFinite(images.secondary.zoom) ? images.secondary.zoom : 100,
              }
            : null,
        });
      })
      .catch((error: unknown) => {
        console.error("Error cargando las imágenes destacadas:", error);
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    const trigger = galleryTriggerRef.current;
    if (!trigger) return;
    if (!("IntersectionObserver" in window)) {
      setShouldLoadGallery(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoadGallery(true);
          observer.disconnect();
        }
      },
      { rootMargin: "700px 0px" }
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoadGallery) return;
    let isCurrent = true;
    setGaleria(publicDataCacheRef.current.galeria);

    fetch(`${API_URL}/api/usuarios/galeria`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`No se pudo cargar la galería (${response.status})`);
        return response.json();
      })
      .then((data: unknown) => {
        if (!Array.isArray(data)) throw new Error("La respuesta de la galería no tiene un formato válido");
        if (!isCurrent) return;
        const updatedGallery = (data as GaleriaFoto[]).filter((foto) => foto.imagen_url);
        publicDataCacheRef.current.galeria = updatedGallery;
        setGaleria(updatedGallery);
        localStorage.setItem(PUBLIC_DATA_CACHE_KEY, JSON.stringify(publicDataCacheRef.current));
      })
      .catch((error: unknown) => {
        console.error("Error cargando la galería pública:", error);
      });

    return () => {
      isCurrent = false;
    };
  }, [shouldLoadGallery]);

  useEffect(() => {
    let ticking = false;
    const updateScrollButton = () => {
      const shouldShow = window.scrollY > 300;
      setShowScrollTop((current) => (current === shouldShow ? current : shouldShow));
      const activationLine = window.innerHeight * 0.35;
      const sectionIds = ["nosotros", "flota", "destinos", "servicios", "requerimiento", "contacto"];
      const currentSection = sectionIds.reduce<string | null>((active, id) => {
        const section = document.getElementById(id);
        return section && section.getBoundingClientRect().top <= activationLine ? id : active;
      }, null);
      setActiveSection((current) => current === currentSection ? current : currentSection);
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateScrollButton);
        ticking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    updateScrollButton();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeMenu = () => setMobileMenuOpen(false);

  const scrollToSection = (event: MouseEvent<HTMLAnchorElement>, sectionId: string, shouldCloseMenu = false) => {
    event.preventDefault();
    const section = document.getElementById(sectionId);
    if (!section) return;

    const navOffset = 96;
    const top = section.getBoundingClientRect().top + window.scrollY - navOffset;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    window.scrollTo({ top, behavior });
    window.history.replaceState(null, "", `#${sectionId}`);

    if (shouldCloseMenu) closeMenu();
  };

  const navLinkClass = (sectionId: string, mobile = false) =>
    `${mobile ? "block text-lg font-bold" : "text-sm font-bold uppercase tracking-widest"} ${
      activeSection === sectionId ? "text-[#E31E24]" : "text-gray-600"
    } transition-colors hover:text-[#E31E24]`;

  return (
    <LocalizedContent>
    <main className="home-page bg-white text-[#1a1a1a] antialiased selection:bg-[#E31E24] selection:text-white font-sans scroll-smooth">
      {/* NAVBAR */}
      <nav className="fixed z-50 w-full border-b border-gray-100 bg-white shadow-sm">
        <div className="mx-auto flex h-24 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex h-full items-center bg-white">
            <Link href="/" className="flex items-center" aria-label="Turesma S.A., inicio">
              <Image
                src="/logo.png"
                alt="Turesma S.A. · Transporte Turístico"
                width={240}
                height={77}
                sizes="(min-width: 640px) 250px, 54vw"
                quality={100}
                className="h-[4.5rem] w-auto max-w-[54vw] object-contain sm:h-[5.125rem] sm:max-w-none"
                priority
              />
            </Link>
          </div>

          {/* Menú Escritorio */}
          <div className="hidden shrink-0 items-center gap-4 xl:flex">
            <a href="#nosotros" onClick={(event) => scrollToSection(event, "nosotros")} className={navLinkClass("nosotros")} aria-current={activeSection === "nosotros" ? "location" : undefined}>Nosotros</a>
            <a href="#flota" onClick={(event) => scrollToSection(event, "flota")} className={navLinkClass("flota")} aria-current={activeSection === "flota" ? "location" : undefined}>Flota</a>
            <a href="#destinos" onClick={(event) => scrollToSection(event, "destinos")} className={navLinkClass("destinos")} aria-current={activeSection === "destinos" ? "location" : undefined}>Destinos</a>
            <a href="#servicios" onClick={(event) => scrollToSection(event, "servicios")} className={navLinkClass("servicios")} aria-current={activeSection === "servicios" ? "location" : undefined}>Servicios</a>
            <a href="#requerimiento" onClick={(event) => scrollToSection(event, "requerimiento")} className={navLinkClass("requerimiento")} aria-current={activeSection === "requerimiento" ? "location" : undefined}>Soluciones</a>
            <a href="#contacto" onClick={(event) => scrollToSection(event, "contacto")} className={navLinkClass("contacto")} aria-current={activeSection === "contacto" ? "location" : undefined}>Contacto</a>
          </div>

          <div className="ml-4 hidden shrink-0 items-center gap-3 xl:flex">
            <LanguageSwitcher />
            <Link href="/login" className="home-button rounded-xl border-2 border-gray-100 px-6 py-2.5 text-sm font-bold text-gray-700 transition-all hover:border-[#E31E24] hover:text-[#E31E24]">
              Ingresar
            </Link>
            <Link href="/registro" className="home-button rounded-xl bg-[#E31E24] px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-200 transition-all hover:bg-black">
              Registrarse
            </Link>
          </div>

          <button
            ref={mobileMenuTriggerRef}
            type="button"
            className="flex min-h-11 min-w-11 items-center justify-center text-[#E31E24] xl:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
          >
            {mobileMenuOpen ? <X size={32} /> : <MenuIcon size={32} />}
          </button>
        </div>

        {/* Menú Móvil */}
        {mobileMenuOpen && (
          <div id="mobile-navigation" ref={mobileMenuRef} role="region" aria-label="Navegación móvil" className="mobile-menu-panel xl:hidden space-y-4 border-b border-gray-100 bg-white p-6 shadow-xl">
            <a href="#nosotros" onClick={(event) => scrollToSection(event, "nosotros", true)} className={navLinkClass("nosotros", true)} aria-current={activeSection === "nosotros" ? "location" : undefined}>Nosotros</a>
            <a href="#flota" onClick={(event) => scrollToSection(event, "flota", true)} className={navLinkClass("flota", true)} aria-current={activeSection === "flota" ? "location" : undefined}>Flota</a>
            <a href="#destinos" onClick={(event) => scrollToSection(event, "destinos", true)} className={navLinkClass("destinos", true)} aria-current={activeSection === "destinos" ? "location" : undefined}>Destinos</a>
            <a href="#servicios" onClick={(event) => scrollToSection(event, "servicios", true)} className={navLinkClass("servicios", true)} aria-current={activeSection === "servicios" ? "location" : undefined}>Servicios</a>
            <a href="#requerimiento" onClick={(event) => scrollToSection(event, "requerimiento", true)} className={navLinkClass("requerimiento", true)} aria-current={activeSection === "requerimiento" ? "location" : undefined}>Soluciones</a>
            <a href="#contacto" onClick={(event) => scrollToSection(event, "contacto", true)} className={navLinkClass("contacto", true)} aria-current={activeSection === "contacto" ? "location" : undefined}>Contacto</a>
            <div className="pt-4 flex flex-col gap-3">
              <LanguageSwitcher />
              <Link href="/login" className="home-button text-center rounded-xl border-2 border-gray-100 py-3 font-bold text-gray-700">Ingresar</Link>
              <Link href="/registro" className="home-button text-center rounded-xl bg-[#E31E24] py-3 font-bold text-white">Registrarse</Link>
            </div>
          </div>
        )}
      </nav>

      {/* HERO SECTION */}
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden pt-20">
        <div className="absolute inset-0 z-0 bg-[#0a0a0a]">
          <Image
            src={HERO_IMAGE_URL}
            alt="Bus de turismo"
            fill
            sizes="100vw"
            priority
            placeholder="blur"
            blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEAAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQIBAT8Af//EABQRAQAAAAAAAAAAAAAAAAAAACD/2gAIAQMBAT8Af//Z"
            className="h-full w-full object-cover opacity-40 transition-transform duration-[10s] hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent" />
        </div>
        
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20 lg:flex lg:items-center">
          <div className="lg:w-2/3">
            <h1 className="hero-intro hero-intro-title mb-6 text-5xl font-black leading-[1.1] tracking-tight text-white md:text-8xl italic">
              VIAJA CON <span className="text-yellow-400">EXCELENCIA.</span>
            </h1>
            <p className="hero-intro hero-intro-copy mb-10 max-w-2xl text-xl font-medium leading-relaxed text-gray-300 md:text-2xl">
              Soluciones de transporte de alta gama en Manta. Puntualidad, confort y seguridad en cada kilómetro del Ecuador.
            </p>
            <div className="hero-intro hero-intro-actions flex flex-wrap gap-4">
              <a href="#flota" onClick={(event) => scrollToSection(event, "flota")} className="home-button group flex items-center gap-3 rounded-2xl bg-white px-8 py-4 font-black uppercase tracking-widest text-black transition-all hover:bg-yellow-400">
                Ver Flota <ChevronRight className="transition-transform group-hover:translate-x-1" />
              </a>
              <a href={`https://wa.me/${TELEFONO_EMPRESA}`} target="_blank" rel="noreferrer" className="home-button rounded-2xl border-2 border-white/20 bg-white/5 px-8 py-4 font-black uppercase tracking-widest text-white backdrop-blur-md transition-all hover:bg-white/10">
                Contactar Asesor
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* SECCIÓN DE EXPERIENCIA Y COTIZACIÓN */}
      <section className="overflow-hidden border-b border-gray-100 bg-[#f7f8fa] py-20 sm:py-24">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-20 lg:px-8" data-reveal>
          <div className="relative mx-auto h-[390px] w-full max-w-[520px] sm:h-[480px]">
            <figure className="absolute left-[3%] top-0 h-[88%] w-[68%] overflow-hidden rounded-[48%_48%_38%_38%] border border-white bg-gray-200 shadow-xl">
              <Image
                src={imagenPrincipal}
                alt="Vehículo de la flota de TURESMA"
                fill
                sizes="(max-width: 640px) 68vw, (max-width: 1024px) 38vw, 330px"
                quality={75}
                loading="eager"
                onError={handleRemoteImageError}
                className="object-cover"
                style={{
                  objectPosition: `${homeShowcaseImages.primary?.position_x ?? 50}% ${homeShowcaseImages.primary?.position_y ?? 50}%`,
                  transform: `scale(${(homeShowcaseImages.primary?.zoom ?? 100) / 100})`,
                }}
              />
            </figure>
            <figure className="absolute bottom-[2%] right-[2%] h-[48%] w-[55%] overflow-hidden rounded-[46%_46%_30%_30%] border-[6px] border-[#f7f8fa] bg-gray-200 shadow-xl">
              <Image
                src={imagenSecundaria}
                alt="Destino para un recorrido con TURESMA"
                fill
                sizes="(max-width: 640px) 55vw, (max-width: 1024px) 31vw, 270px"
                quality={75}
                onError={handleRemoteImageError}
                className="object-cover"
                style={{
                  objectPosition: `${homeShowcaseImages.secondary?.position_x ?? 50}% ${homeShowcaseImages.secondary?.position_y ?? 50}%`,
                  transform: `scale(${(homeShowcaseImages.secondary?.zoom ?? 100) / 100})`,
                }}
              />
            </figure>
            <div className="absolute right-[5%] top-[25%] flex h-16 w-16 rotate-12 items-center justify-center rounded-full bg-[#E31E24] text-4xl font-black text-white shadow-lg sm:right-[8%] sm:h-20 sm:w-20 sm:text-5xl" aria-hidden="true">
              *
            </div>
            <div className="absolute bottom-[5%] left-[5%] flex items-center gap-2 rounded-2xl border border-white bg-white/95 px-4 py-3 shadow-lg">
              <Bus size={22} className="text-[#E31E24]" aria-hidden="true" />
              <span className="text-xs font-black uppercase tracking-wide text-gray-800">Flota TURESMA</span>
            </div>
          </div>

          <div className="max-w-xl lg:py-8">
            <p className="mb-4 text-xs font-black uppercase tracking-[0.24em] text-[#E31E24]">
              Transporte turístico y ejecutivo
            </p>
            <h2 className="text-4xl font-black leading-tight tracking-tight text-gray-950 sm:text-5xl">
              Tu viaje, a tu medida.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-gray-600 sm:text-lg">
              Cuéntanos tu destino, fecha y tipo de recorrido. Explora las alternativas de TURESMA y solicita una cotización para planificar tu traslado.
            </p>

            <div className="mt-8 divide-y divide-gray-200">
              <article className="flex gap-4 py-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-[#E31E24]">
                  <CalendarRange size={24} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-lg font-black text-gray-900">Cotiza tu recorrido</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">
                    Revisa una propuesta para tu ruta y servicio antes de confirmar la reserva.
                  </p>
                </div>
              </article>
              <article className="flex gap-4 py-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                  <Bus size={24} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-lg font-black text-gray-900">Vehículos para cada necesidad</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">
                    Autos, camionetas, SUV, vans, minibuses y buses para tu recorrido.
                  </p>
                </div>
              </article>
              <article className="flex gap-4 py-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <MapPin size={24} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-lg font-black text-gray-900">Guía turístico bajo solicitud</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">
                    ¿Necesitas un guía? Solicítalo al cotizar tu recorrido y consulta su disponibilidad.
                  </p>
                </div>
              </article>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="home-button inline-flex items-center gap-3 rounded-full bg-[#E31E24] px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-red-200 hover:bg-black"
              >
                Solicitar cotización <ArrowUpRight size={18} aria-hidden="true" />
              </Link>
              <a
                href="#flota"
                onClick={(event) => scrollToSection(event, "flota")}
                className="home-button inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-sm font-black text-gray-700 hover:text-[#E31E24]"
              >
                Ver la flota <ChevronRight size={18} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* SECCIÓN NOSOTROS */}
      <section id="nosotros" className="relative scroll-mt-24 border-b border-gray-50 bg-white py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
          <div className="mb-12 text-center">
            <h2 className="text-4xl font-black italic tracking-tighter text-[#E31E24] md:text-6xl uppercase">Sobre Nosotros</h2>
            <div className="h-1.5 w-32 bg-yellow-400 rounded-full mt-2 mx-auto"></div>
          </div>
          <div className="mb-16 grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
            <div className="relative min-h-[380px] pr-4 sm:min-h-[390px] sm:pr-14">
              <figure className="absolute left-0 right-0 top-0 h-[320px] overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-900 shadow-[0_18px_45px_-24px_rgba(15,23,42,0.65)] sm:inset-y-0 sm:right-10 sm:h-auto">
              <Image
                src={getSafeImageSource(cityShowcase.primary_image_url)}
                alt={cityShowcase.primary_alt}
                fill
                sizes="(max-width: 1024px) 100vw, 55vw"
                quality={95}
                className="object-cover brightness-105 saturate-[1.08] transition-transform duration-700 hover:scale-105"
                style={{
                  objectPosition: `${cityShowcase.primary_position_x}% ${cityShowcase.primary_position_y}%`,
                  transform: `scale(${cityShowcase.primary_zoom / 100})`,
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
                <figcaption className="absolute bottom-3 left-4 text-[10px] font-medium text-white/65 drop-shadow-md">
                  Manta, Manabí, Ecuador
                </figcaption>
              </figure>
              <figure className="absolute bottom-0 right-0 aspect-square w-36 overflow-hidden rounded-2xl border-2 border-white/90 bg-white shadow-[0_16px_30px_-18px_rgba(15,23,42,0.8)] sm:bottom-4 sm:h-40 sm:w-40">
                <Image
                  src={getSafeImageSource(cityShowcase.secondary_image_url)}
                  alt={cityShowcase.secondary_alt}
                  fill
                  sizes="(max-width: 640px) 128px, 160px"
                  quality={95}
                  className="object-cover"
                  style={{
                    objectPosition: `${cityShowcase.secondary_position_x}% ${cityShowcase.secondary_position_y}%`,
                    transform: `scale(${cityShowcase.secondary_zoom / 100})`,
                  }}
                />
                <figcaption className="absolute inset-x-1 bottom-1 rounded-md bg-slate-950/65 px-1 py-1 text-center text-[8px] font-bold uppercase tracking-wide text-white">
                  Manta, Manabí
                </figcaption>
              </figure>
            </div>
            <div className="text-center lg:text-left">
              <p className="mb-4 text-sm font-black uppercase tracking-[0.24em] text-[#E31E24]">{cityShowcase.eyebrow}</p>
              <h3 className="text-3xl font-black leading-tight tracking-tight text-gray-950 sm:text-4xl">
                {cityShowcase.title}
              </h3>
              <p className="mt-5 text-lg font-medium leading-relaxed text-gray-600">
                {cityShowcase.description}
              </p>
              <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                {cityShowcase.label}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-12 md:grid-cols-4">
            {[
              { label: "Turismo VIP", icon: BriefcaseBusiness, color: "text-[#E31E24]", bg: "bg-red-50" },
              { label: "Seguridad 24/7", icon: BadgeCheck, color: "text-green-600", bg: "bg-green-50" },
              { label: "Puntualidad", icon: Clock3, color: "text-orange-500", bg: "bg-orange-50" },
              { label: "Logística", icon: Activity, color: "text-blue-600", bg: "bg-blue-50" },
            ].map((f, i) => (
              <div key={i} data-icon-card className="home-card group text-center">
                <div className={`mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[2rem] ${f.bg} transition-all group-hover:rotate-6 group-hover:scale-110`}>
                  <f.icon data-icon-reveal className={f.color} size={32} />
                </div>
                <h3 className="text-lg font-black uppercase tracking-tighter text-gray-800">{f.label}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECCIÓN MISIÓN Y VISIÓN */}
      <section className="relative overflow-hidden bg-[#0b0f1a] py-24 text-white">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -left-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-[#E31E24] blur-3xl" />
          <div className="absolute -right-24 bottom-0 h-64 w-64 rounded-full bg-yellow-400 blur-3xl" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
          <div className="mb-14 text-center">
            <h2 className="text-4xl font-black italic uppercase tracking-tighter text-white md:text-6xl">Nuestra esencia</h2>
            <div className="mx-auto mt-2 h-1.5 w-32 rounded-full bg-yellow-400" />
            <p className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-relaxed text-gray-300">
              El compromiso que guía cada traslado y cada decisión de TURESMA.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 md:gap-0">
            <article className="border-b border-white/10 pb-8 text-center md:border-b-0 md:border-r md:pr-12 md:pb-0">
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E31E24] text-white shadow-lg shadow-red-950/30">
                <Route size={28} />
              </div>
              <h3 className="text-2xl font-black uppercase tracking-tight text-yellow-400">Misión</h3>
              <p className="mx-auto mt-4 max-w-2xl text-justify text-base font-medium leading-relaxed text-gray-300">
                Brindar servicios de transporte turístico, ejecutivo y logístico seguros, cómodos y confiables, apoyados en un equipo responsable, tecnología y altos estándares de calidad. Trabajamos para ofrecer traslados eficientes y una experiencia satisfactoria a nuestros clientes, tanto a nivel local como nacional.
              </p>
            </article>

            <article className="pt-8 text-center md:pl-12 md:pt-0">
              <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-400 text-[#0b0f1a] shadow-lg shadow-yellow-950/20">
                <ShieldCheck size={28} />
              </div>
              <h3 className="text-2xl font-black uppercase tracking-tight text-yellow-400">Visión</h3>
              <p className="mx-auto mt-4 max-w-2xl text-justify text-base font-medium leading-relaxed text-gray-300">
                Ser una empresa referente a nivel nacional en transporte turístico, ejecutivo y logístico, reconocida por la excelencia de nuestro servicio, la innovación, la seguridad y el compromiso permanente con nuestros clientes.
              </p>
            </article>
          </div>

          <p className="mt-14 text-center text-lg font-black uppercase italic tracking-[0.14em] text-white md:text-xl">
            Seguridad, confianza y excelencia en cada camino.
          </p>
        </div>
      </section>

      {/* SECCIÓN FLOTA */}
      <section id="flota" className="bg-[#fcfcfc] py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
          <div className="mb-16 text-center">
            <h2 className="text-4xl font-black italic tracking-tighter text-[#E31E24] md:text-6xl uppercase">Nuestra Flota</h2>
            <div className="h-1.5 w-32 bg-yellow-400 rounded-full mt-2 mx-auto"></div>
            <p className="mt-4 text-gray-500 font-medium">Unidades disponibles para su servicio</p>
          </div>

          {loadingVehiculos ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-[#E31E24]" />
            </div>
          ) : vehiculos.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Bus size={48} className="mx-auto mb-4 opacity-30" />
              <p className="font-bold text-lg">Pronto agregaremos nuestra flota</p>
            </div>
          ) : (
            <div
              className="relative"
            >
              {/* Botón izquierda */}
              <button
                type="button"
                onClick={() => scrollFlota("left")}
                aria-label="Anterior"
                className="absolute left-0 top-1/2 z-20 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white p-3 text-[#E31E24] shadow-xl ring-1 ring-gray-200 transition-all hover:bg-[#E31E24] hover:text-white md:flex"
              >
                <ChevronLeft size={24} />
              </button>
              {/* Botón derecha */}
              <button
                type="button"
                onClick={() => scrollFlota("right")}
                aria-label="Siguiente"
                className="absolute right-0 top-1/2 z-20 hidden translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white p-3 text-[#E31E24] shadow-xl ring-1 ring-gray-200 transition-all hover:bg-[#E31E24] hover:text-white md:flex"
              >
                <ChevronRight size={24} />
              </button>

              {/* Carrusel horizontal */}
              <div
                ref={flotaRef}
                className="flota-carousel flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth pb-4"
              >
                {vehiculos.map((v) => (
                  <div
                    key={v.id}
                    data-flota-card
                    className="home-card flex w-[85%] flex-none snap-center flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl hover:shadow-2xl sm:w-[360px]"
                  >
                    <Image
                      src={getSafeImageSource(v.imagen_url)}
                      alt={`${v.tipo || "Vehículo"} ${v.modelo || ""}`.trim()}
                      data-no-translate
                      width={720}
                      height={512}
                      sizes="(max-width: 640px) 85vw, 360px"
                      quality={75}
                      onError={handleRemoteImageError}
                      className="h-56 w-full object-cover sm:h-64"
                    />
                    <div className="p-7 flex flex-col flex-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-green-600">
                        {v.capacidad ? `${v.capacidad} Pasajeros` : "Transporte"}
                      </span>
                      <h4 data-no-translate className="mt-2 text-2xl font-black italic text-gray-900">
                        {v.modelo || v.tipo || "Vehículo"}
                      </h4>
                      {v.descripcion && (
                        <p data-no-translate className="mt-2 text-sm text-gray-500 leading-relaxed flex-1">{v.descripcion}</p>
                      )}
                      <div className="mt-6 flex items-center justify-end border-t pt-6">
                        <Bus size={20} className="text-[#E31E24]" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Controles móviles + hint */}
              <div className="mt-4 flex items-center justify-center gap-4 md:hidden">
                <button type="button" onClick={() => scrollFlota("left")} aria-label="Anterior" className="flex items-center justify-center rounded-full bg-white p-3 text-[#E31E24] shadow-lg ring-1 ring-gray-200 active:scale-95">
                  <ChevronLeft size={22} />
                </button>
                <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Desliza</span>
                <button type="button" onClick={() => scrollFlota("right")} aria-label="Siguiente" className="flex items-center justify-center rounded-full bg-white p-3 text-[#E31E24] shadow-lg ring-1 ring-gray-200 active:scale-95">
                  <ChevronRight size={22} />
                </button>
              </div>

              <style dangerouslySetInnerHTML={{ __html: `.flota-carousel::-webkit-scrollbar{height:8px}.flota-carousel::-webkit-scrollbar-thumb{background:#E31E24;border-radius:9999px}.flota-carousel::-webkit-scrollbar-track{background:transparent}` }} />
            </div>
          )}

          <div className="mt-12 text-center">
            <Link href="/login" className="home-button inline-flex items-center gap-3 rounded-2xl bg-[#E31E24] px-8 py-4 font-black uppercase tracking-widest text-white shadow-lg shadow-red-200 transition-all hover:bg-black">
              Reservar un vehículo <ChevronRight size={20} />
            </Link>
          </div>
        </div>
      </section>

      <div id="destinos" ref={galleryTriggerRef} className="h-px" aria-hidden="true" />

      {/* SECCIÓN GALERÍA DE VIAJES (fotos publicadas por el admin) */}
      {fotosGaleria.length > 0 && (
        <section id="galeria" className="py-24 bg-white border-t border-gray-50">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
            <div className="mb-16 text-center">
              <h2 className="text-4xl font-black italic tracking-tighter text-[#E31E24] md:text-6xl uppercase">Nuestros Viajes</h2>
              <div className="h-1.5 w-32 bg-yellow-400 rounded-full mt-2 mx-auto"></div>
              <p className="mt-4 text-gray-500 font-medium">Momentos reales de nuestros recorridos por Manabí y todo el Ecuador</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {fotosGaleria.map((foto) => (
                <figure
                  key={foto.id}
                  className="home-card group relative overflow-hidden rounded-3xl shadow-xl aspect-[4/3] bg-gray-100"
                >
                  <Image
                    src={getSafeImageSource(foto.imagen_url)}
                    alt={foto.titulo || "Viaje realizado por Turesma"}
                    data-no-translate
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    quality={75}
                    onError={handleRemoteImageError}
                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  {(foto.titulo || foto.descripcion) && (
                    <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-6 pt-16 translate-y-2 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                      {foto.titulo && (
                        <h3 data-no-translate className="text-lg font-black italic text-white uppercase tracking-tight">{foto.titulo}</h3>
                      )}
                      {foto.descripcion && (
                        <p data-no-translate className="mt-1 text-sm font-medium text-white/80 leading-snug">{foto.descripcion}</p>
                      )}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* DESTINOS */}
      {fotosDestinos.length > 0 && (
        <section className="bg-[#f7f8fa] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
            <div className="mx-auto mb-14 max-w-3xl text-center">
              <p className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-[#E31E24]">Desde Manta hacia Ecuador</p>
              <h2 className="text-4xl font-black italic uppercase tracking-tighter text-gray-900 md:text-6xl">
                Destinos para tu próximo viaje
              </h2>
              <div className="mx-auto mt-3 h-1.5 w-32 rounded-full bg-yellow-400" />
              <p className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-relaxed text-gray-600">
                Algunos lugares emblemáticos que puedes considerar para tu próximo traslado.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {fotosDestinos.map((destino) => (
                <article key={destino.id} className="home-card group flex flex-col overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-lg transition-shadow hover:shadow-2xl">
                  <div className="relative aspect-[5/4] overflow-hidden bg-gray-200">
                    <Image
                      src={getSafeImageSource(destino.imagen_url)}
                      alt={destino.titulo || "Destino en Ecuador"}
                      data-no-translate
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      quality={75}
                      className="object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
                    {destino.titulo && (
                      <h3 data-no-translate className="absolute inset-x-0 bottom-0 p-5 text-xl font-black italic tracking-tight text-white drop-shadow-md">
                        {destino.titulo}
                      </h3>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    {destino.descripcion && <p data-no-translate className="text-sm font-medium leading-relaxed text-gray-600">{destino.descripcion}</p>}
                    {(destino.credito || destino.licencia) && (
                      <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-gray-100 pt-3 text-xs font-medium text-gray-500">
                        {destino.credito && (
                          <>
                            <span>Foto:</span>
                            {destino.fuente_url ? (
                              <a href={destino.fuente_url} target="_blank" rel="noreferrer" className="underline decoration-gray-300 underline-offset-2 hover:text-[#E31E24]">
                                <span data-no-translate>{destino.credito}</span>
                              </a>
                            ) : (
                              <span data-no-translate>{destino.credito}</span>
                            )}
                          </>
                        )}
                        {destino.credito && destino.licencia && <span aria-hidden="true">·</span>}
                        {destino.licencia && (destino.licencia_url ? (
                          <a href={destino.licencia_url} target="_blank" rel="noreferrer" className="underline decoration-gray-300 underline-offset-2 hover:text-[#E31E24]">
                            <span data-no-translate>{destino.licencia}</span>
                          </a>
                        ) : (
                          <span data-no-translate>{destino.licencia}</span>
                        ))}
                      </p>
                    )}
                    <Link
                      href="/login"
                      className="mt-5 inline-flex items-center gap-1 self-start text-xs font-black uppercase tracking-wider text-[#E31E24] transition-colors hover:text-gray-900"
                    >
                      Cotizar traslado <ArrowUpRight size={15} aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-12 rounded-3xl border border-gray-200 bg-white px-6 py-8 text-center shadow-sm sm:px-10">
              <h3 className="text-xl font-black italic tracking-tight text-gray-900 sm:text-2xl">
                ¡Hay muchos destinos más por descubrir!
              </h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm font-medium leading-relaxed text-gray-600 sm:text-base">
                Cuéntanos a dónde quieres ir y cotiza tu traslado con Turesma.
              </p>
              <Link
                href="/login"
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#E31E24] px-6 py-3 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-gray-900"
              >
                Cotiza tu viaje <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* SECCIÓN VIDEOS */}
      <section id="videos" className="relative overflow-hidden bg-[#0b0f1a] py-24 text-white">
        <div className="absolute -left-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-[#E31E24]/20 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-64 w-64 rounded-full bg-yellow-400/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
          <div className="mb-14 text-center">
            <h2 className="text-4xl font-black italic uppercase tracking-tighter text-white md:text-6xl">TURESMA en movimiento</h2>
            <div className="mx-auto mt-2 h-1.5 w-32 rounded-full bg-yellow-400" />
            <p className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-relaxed text-gray-300">
              Conoce nuestros vehículos, servicios y experiencias en carretera.
            </p>
          </div>

          {videosGaleria.length > 0 ? (
            <div className="mx-auto max-w-4xl space-y-6">
              {mosaicosVideos.map((mosaico) => {
                const hasPortraitVideo = mosaico.some((video) => getVideoAspectRatio(video) < 1);
                const allPortraitVideos = mosaico.every((video) => getVideoAspectRatio(video) < 1);
                const portraitCount = mosaico.filter((video) => getVideoAspectRatio(video) < 1).length;
                const hasPortraitVideosInOppositeCorners = portraitCount === 2
                  && (mosaico.length === 3 || mosaico.length === 4);
                const hasFourVideoComposition = mosaico.length === 4 && portraitCount === 2;
                return (
                    <div
                      key={mosaico[0].id}
                      className={hasFourVideoComposition
                        ? "grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] md:grid-rows-2 md:items-center"
                        : hasPortraitVideosInOppositeCorners
                          ? "grid grid-cols-1 gap-4 md:grid-cols-[1fr_2fr_1fr] md:items-center"
                        : hasPortraitVideo
                          ? "flex flex-wrap items-start justify-center gap-4"
                          : `grid grid-cols-1 gap-4 ${
                          mosaico.length === 1
                            ? "md:grid-cols-1"
                            : mosaico.length === 2
                              ? "md:grid-cols-2"
                              : "md:grid-cols-3 md:grid-rows-2"
                        }`}
                    >
                      {mosaico.map((video, index) => {
                        const videoAspectRatio = getVideoAspectRatio(video);
                        const isPortrait = videoAspectRatio < 1;
                        const isFeaturedLandscape = !hasPortraitVideo && mosaico.length === 3 && index === 0;
                        const portraitIndex = mosaico
                          .slice(0, index)
                          .filter((item) => getVideoAspectRatio(item) < 1).length;
                        const landscapeIndex = mosaico
                          .slice(0, index)
                          .filter((item) => getVideoAspectRatio(item) >= 1).length;
                        const oppositeCornerClass = hasPortraitVideosInOppositeCorners
                          ? isPortrait
                            ? portraitIndex === 0
                              ? "md:col-start-1 md:row-span-2"
                              : hasFourVideoComposition ? "md:col-start-4 md:row-span-2" : "md:col-start-3 md:row-span-2"
                            : hasFourVideoComposition
                              ? landscapeIndex === 0
                                ? "md:col-start-2 md:col-span-2 md:row-start-1"
                                : "md:col-start-2 md:col-span-2 md:row-start-2"
                              : "md:col-start-2 md:row-start-1"
                          : "";
                        const portraitLayoutWidth = mosaico.length === 1
                          ? "md:w-full md:max-w-[360px]"
                          : allPortraitVideos && mosaico.length === 3
                            ? "md:w-[calc(33.333%-10.667px)]"
                            : isPortrait
                              ? "md:w-[calc(33.333%-8px)]"
                              : "md:w-[calc(66.667%-8px)]";

                        return (
                          <figure
                            key={video.id}
                            className={`group relative mx-auto min-w-0 w-full overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] shadow-2xl ${
                              isPortrait ? "max-w-[280px] md:max-w-none" : "max-w-[320px] md:max-w-none"
                            } ${
                              hasFourVideoComposition
                                ? `w-full ${oppositeCornerClass}`
                                : hasPortraitVideosInOppositeCorners
                                ? `w-full ${oppositeCornerClass}`
                                : hasPortraitVideo
                                ? `w-full ${portraitLayoutWidth}`
                                : isFeaturedLandscape
                                  ? "md:col-span-2 md:row-span-2"
                                  : ""
                            }`}
                          >
                            <VideoPlayer
                              src={video.imagen_url}
                              posterUrl={getSafeImageSource(video.video_poster_url)}
                              title={video.titulo}
                              offsetX={video.video_offset_x}
                              offsetY={video.video_offset_y}
                              zoom={video.video_zoom}
                              videoFormat={video.video_format}
                              aspectRatio={video.video_aspect_ratio}
                              className={hasPortraitVideo || isFeaturedLandscape || hasFourVideoComposition
                                ? "h-auto w-full max-h-none"
                                : undefined}
                            />
                            {(video.titulo || video.descripcion) && (
                              <figcaption className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/75 to-transparent p-4 pt-5">
                                {video.titulo && <h3 className="text-lg font-black uppercase italic tracking-tight text-white">{video.titulo}</h3>}
                                {video.descripcion && <p className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-gray-200">{video.descripcion}</p>}
                              </figcaption>
                            )}
                          </figure>
                        );
                      })}
                    </div>
                );
              })}
            </div>
          ) : (
            <div className="mx-auto flex min-h-80 max-w-4xl flex-col items-center justify-center rounded-[2rem] border border-white/10 bg-white/[0.04] px-6 py-12 text-center shadow-2xl">
              <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-yellow-400 text-[#0b0f1a] shadow-lg shadow-yellow-400/20">
                <PlayCircle size={42} strokeWidth={1.8} />
              </div>
              <h3 className="text-2xl font-black uppercase italic tracking-tight text-white">Próximamente en movimiento</h3>
              <p className="mt-3 max-w-xl text-base font-medium leading-relaxed text-gray-400">
                Aquí podrás descubrir los videos de nuestros recorridos, vehículos y servicios.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* SECCIÓN SERVICIOS */}
      <section id="servicios" className="py-24 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
           <div className="mb-16 text-center">
             <h2 className="text-4xl font-black italic tracking-tighter text-[#E31E24] md:text-6xl uppercase">Servicios Premium</h2>
             <div className="h-1.5 w-32 bg-yellow-400 rounded-full mt-2 mx-auto"></div>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="home-card p-8 rounded-[2rem] bg-gray-50 border-b-4 border-[#E31E24] hover:bg-gray-100">
              <h3 className="text-2xl font-black italic text-gray-900 mb-4 uppercase">Traslados Ejecutivos</h3>
              <p className="text-gray-600 font-medium leading-relaxed">Puntualidad absoluta para viajes de negocios, traslados al aeropuerto y logística corporativa.</p>
            </div>
            <div className="home-card p-8 rounded-[2rem] bg-gray-50 border-b-4 border-yellow-400 hover:bg-gray-100">
              <h3 className="text-2xl font-black italic text-gray-900 mb-4 uppercase">Tours Turísticos</h3>
              <p className="text-gray-600 font-medium leading-relaxed">Guías certificados y rutas personalizadas por la costa manabita y todo el Ecuador.</p>
            </div>
            <div className="home-card p-8 rounded-[2rem] bg-gray-50 border-b-4 border-green-600 hover:bg-gray-100">
              <h3 className="text-2xl font-black italic text-gray-900 mb-4 uppercase">Logística de Eventos</h3>
              <p className="text-gray-600 font-medium leading-relaxed">Coordinación de transporte para congresos, bodas y eventos institucionales masivos.</p>
            </div>
          </div>
        </div>
      </section>

      {/* SECCIÓN SOLUCIONES A LA MEDIDA */}
      <section id="requerimiento" className="relative overflow-hidden bg-[#f7f8fa] py-24">
        <div className="absolute -right-32 top-16 h-80 w-80 rounded-full bg-yellow-400/10 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <p className="mb-3 text-xs font-black uppercase tracking-[0.3em] text-[#E31E24]">Más que una flota</p>
            <h2 className="text-4xl font-black italic uppercase tracking-tighter text-gray-900 md:text-6xl">
              Cuéntanos qué necesitas.
            </h2>
            <div className="mx-auto mt-3 h-1.5 w-32 rounded-full bg-yellow-400" />
            <p className="mt-6 text-lg font-medium leading-relaxed text-gray-600 md:text-xl">
              Diseñamos la solución de transporte de acuerdo con tu ruta, tus tiempos y el tamaño de tu operación.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { title: "Traslado individual", text: "Un viaje cómodo y puntual para una persona o familia.", icon: MapPin, color: "text-[#E31E24]", bg: "bg-red-50" },
              { title: "Gira turística", text: "Itinerarios personalizados para descubrir Ecuador.", icon: Route, color: "text-blue-600", bg: "bg-blue-50" },
              { title: "Transporte empresarial", text: "Movilización coordinada para equipos y colaboradores.", icon: BriefcaseBusiness, color: "text-green-600", bg: "bg-green-50" },
              { title: "Logística de eventos", text: "Varios vehículos, horarios y puntos bajo una sola coordinación.", icon: UsersRound, color: "text-orange-500", bg: "bg-orange-50" },
              { title: "Requerimiento especial", text: "Cuéntanos el desafío y buscamos la alternativa adecuada.", icon: SlidersHorizontal, color: "text-purple-600", bg: "bg-purple-50" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} data-icon-card className="home-card group rounded-3xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-xl">
                  <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl ${item.bg} transition-transform group-hover:rotate-6`}>
                    <Icon data-icon-reveal size={23} className={item.color} />
                  </div>
                  <h3 className="text-lg font-black uppercase leading-tight tracking-tight text-gray-900">{item.title}</h3>
                  <p className="mt-3 text-sm font-medium leading-relaxed text-gray-500">{item.text}</p>
                </article>
              );
            })}
          </div>

          <div className="mt-10 grid gap-4 rounded-[2rem] bg-[#0b0f1a] p-6 text-white shadow-2xl md:grid-cols-[1fr_auto] md:items-center md:p-8">
            <div>
              <h3 className="flex items-center gap-2 text-xl font-black uppercase italic tracking-tight md:text-2xl">
                <CalendarRange className="text-yellow-400" size={24} />
                Tú defines el requerimiento. Nosotros lo coordinamos.
              </h3>
              <p className="mt-3 max-w-3xl text-sm font-medium leading-relaxed text-gray-300 md:text-base">
                Adaptamos vehículo, horarios, ruta y operación para ofrecerte una propuesta clara, segura y conveniente.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-col lg:flex-row">
              <Link href="/login" className="home-button inline-flex items-center justify-center gap-2 rounded-xl bg-[#E31E24] px-5 py-3 text-center text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-white hover:text-[#E31E24]">
                Cotizar en línea <ChevronRight size={16} />
              </Link>
              <a href={`https://wa.me/${TELEFONO_EMPRESA}?text=${encodeURIComponent("Hola TURESMA, tengo un requerimiento de transporte personalizado.")}`} target="_blank" rel="noreferrer" className="home-button inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-center text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-white/10">
                Cuéntanos tu requerimiento
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* SECCIÓN MISIÓN - FRASE PRINCIPAL */}
      <section className="relative py-32 overflow-hidden bg-gradient-to-r from-[#0a0a1a] via-[#0f1a2e] to-[#0a0a1a]">
        {/* Efectos de fondo */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/2 left-1/4 w-96 h-96 bg-[#E31E24]/20 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-yellow-400/10 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center min-h-[500px] text-center" data-reveal>
          {/* Frase principal con comillas pegadas al texto */}
          <div className="max-w-4xl mb-8">
            <p className="text-2xl md:text-4xl font-black italic text-white leading-tight tracking-tight drop-shadow-lg">
              <span className="text-yellow-400">&ldquo;</span>Cada viaje es una oportunidad para llegar más lejos, no solo en distancia, sino en confianza<span className="text-yellow-400">&rdquo;</span>
            </p>
          </div>

          {/* Frase secundaria */}
          <div className="mb-8">
            <p className="text-lg md:text-2xl font-bold italic text-yellow-400 leading-tight tracking-tight drop-shadow-lg">
              Impulsamos caminos, conectamos sueños.
            </p>
          </div>

          {/* Subtítulo con gerencia */}
          <div>
            <p className="text-sm md:text-lg font-black uppercase text-yellow-400 tracking-[0.3em]">
              GERENCIA, TURESMA MANTA
            </p>
          </div>
        </div>
      </section>

      {/* SECCIÓN INFORMATIVA (REEMPLAZO DE FORMULARIO) */}
      <section id="contacto" className="py-24 bg-[#fcfcfc]">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
          <div className="overflow-hidden rounded-[3rem] bg-gray-900 shadow-2xl lg:flex min-h-[500px]">
            
            {/* LADO IZQUIERDO: MARCA */}
            <div className="bg-[#E31E24] p-8 sm:p-12 lg:w-1/2 flex flex-col justify-center text-white relative">
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-yellow-400/20 blur-3xl" />

              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black italic tracking-tighter mb-6 uppercase leading-none">
                VIAJA SEGURO,<br />
                <span className="text-yellow-400">VIAJA CON TURESMA.</span>
              </h2>
              <p className="text-xl font-medium opacity-90 mb-10 leading-relaxed max-w-md">
                Líderes en transporte turístico en Manta. Calidad garantizada para cada pasajero.
              </p>
              
              <div className="space-y-4">
                <div className="flex items-center gap-4 bg-black/10 p-4 rounded-2xl border border-white/10 hover:bg-black/20 transition-all">
                  <div className="bg-yellow-400 p-3 rounded-xl text-black shadow-lg"><MapPin size={24} /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Ubicación</p>
                    <p className="font-bold">Manta, Manabí, Ecuador</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-black/10 p-4 rounded-2xl border border-white/10 hover:bg-black/20 transition-all">
                  <div className="bg-white p-3 rounded-xl text-[#E31E24] shadow-lg"><Mail size={24} /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Email Oficial</p>
                    <p className="text-sm font-bold sm:text-base">turesmasa@hotmail.com</p>
                  </div>
                </div>
              </div>
            </div>

            {/* LADO DERECHO: VITRINA INFORMATIVA */}
            <div className="p-12 lg:w-1/2 bg-white flex flex-col justify-center">
              <h3 className="text-3xl font-black italic text-gray-900 mb-8 uppercase tracking-tighter border-l-4 border-[#E31E24] pl-4">
                ¿Por qué elegirnos?
              </h3>
              
              <div className="grid gap-6">
                {[
                  { title: "Rastreo Satelital GPS", desc: "Seguridad total en tiempo real para todas nuestras unidades.", icon: <ShieldCheck className="text-[#E31E24]" /> },
                  { title: "Seguros de Pasajeros", desc: "Cobertura completa y cumplimiento de toda la normativa legal.", icon: <BadgeCheck className="text-green-600" /> },
                  { title: "Atención 24 Horas", desc: "Soporte y coordinación logística los 365 días del año.", icon: <Activity className="text-blue-600" /> }
                ].map((item, index) => (
                  <div key={index} className="home-card flex gap-4 p-5 rounded-2xl border border-gray-100 hover:shadow-xl">
                    <div className="mt-1 shrink-0">{item.icon}</div>
                    <div>
                      <h4 className="font-black text-gray-800 uppercase text-sm tracking-tight">{item.title}</h4>
                      <p className="text-gray-500 text-sm font-medium leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-10">
                <a 
                  href={`https://wa.me/${TELEFONO_EMPRESA}`} 
                  target="_blank"
                  className="flex w-full items-center justify-between gap-4 rounded-2xl bg-black px-7 py-5 text-left font-black uppercase leading-snug tracking-widest text-white shadow-xl shadow-gray-200 transition-all hover:bg-[#E31E24] sm:justify-center sm:px-8 sm:text-center"
                >
                  <span className="min-w-0">Conocer más servicios</span>
                  <ChevronRight size={20} className="shrink-0 text-yellow-400" />
                </a>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* SECCIÓN FAQ */}
      <section className="bg-[#f1f3f6] py-12 md:py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" data-reveal>
          <div className="mb-6 text-center md:mb-8">
            <h2 className="text-2xl font-black italic uppercase tracking-tighter text-[#E31E24] md:text-4xl">
              Preguntas Frecuentes
            </h2>
            <div className="mx-auto mt-2 h-1.5 w-32 rounded-full bg-yellow-400" />
            <p className="mx-auto mt-3 max-w-2xl text-sm font-medium text-gray-700 md:text-base">
              Resolvemos las dudas más comunes para que reserves con más rapidez y confianza.
            </p>
          </div>

          <div className="mx-auto grid w-full max-w-4xl gap-2.5">
            {[
              {
                question: "¿Cómo hago una reserva?",
                answer:
                  "Puedes reservar por medio de nuestro sistema web o  WhatsApp o con un asesor. Solo necesitamos fecha, hora, origen, destino y cantidad de pasajeros para confirmar tu unidad.",
              },
              {
                question: "¿Atienden viajes dentro y fuera de Manta?",
                answer:
                  "Sí. Operamos en Manta y realizamos traslados a nivel provincial y nacional, según disponibilidad y planificación de ruta.",
              },
              {
                question: "¿Cómo elijo el vehículo adecuado para mi viaje?",
                answer:
                  "La mejor opción depende del número de pasajeros, el equipaje y el tipo de recorrido. Al cotizar, cuéntanos esos detalles y te ayudaremos a elegir el vehículo adecuado.",
              },
              {
                question: "¿Puedo pedir una cotización antes de reservar?",
                answer:
                  "Claro. Te enviamos una cotización previa sin compromiso para que conozcas tarifas, condiciones y tiempos estimados.",
              },
              {
                question: "¿Ofrecen transporte turístico para grupos?",
                answer:
                  "Sí. Ofrecemos transporte turístico para grupos desde Manta hacia destinos de Manabí y todo Ecuador. La unidad se coordina según la cantidad de pasajeros y las características del recorrido.",
              },
              {
                question: "¿Realizan traslados ejecutivos desde Manta?",
                answer:
                  "Sí. Realizamos traslados ejecutivos, corporativos, al aeropuerto y entre ciudades, con planificación previa para cada servicio.",
              },
              {
                question: "¿Ofrecen transporte para empresas y eventos?",
                answer:
                  "Sí. Coordinamos soluciones de transporte para empresas, congresos, bodas, eventos institucionales, grupos turísticos y recorridos especiales.",
              },
              {
                question: "¿Qué alternativas de transporte tienen disponibles?",
                answer:
                  "Contamos con autos, camionetas, SUV, vans, minibuses y buses, sujetos a disponibilidad y al número de pasajeros.",
              },
              {
                question: "¿A qué destinos realizan traslados?",
                answer:
                  "Operamos desde Manta hacia destinos de Manabí y otras ciudades del Ecuador. Revisamos cada ruta, fecha y disponibilidad al momento de preparar la cotización.",
              },
              {
                question: "¿Qué información necesito para solicitar una cotización?",
                answer:
                  "Solo necesitamos la fecha, hora, origen, destino y cantidad de pasajeros. También puedes indicarnos si llevarás equipaje o si se trata de un evento o recorrido especial.",
              },
            ].map((faq, index) => {
              const isOpen = openFaqIndex === index;

              return (
                <article
                  key={index}
                  className={`home-card rounded-xl border bg-white px-4 py-5 shadow-sm transition-all duration-500 ${
                    isOpen ? "border-[#E31E24]/30 shadow-md" : "border-gray-200"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex((current) => (current === index ? null : index))}
                    aria-expanded={isOpen}
                    aria-controls={`faq-answer-${index}`}
                    className="relative flex min-h-11 w-full items-center pr-7 text-[#0b1220] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E31E24] focus-visible:ring-offset-2"
                  >
                    <span className="block w-full text-left text-base font-black italic uppercase tracking-tight md:text-[1.1rem]">
                      {faq.question}
                    </span>
                    <ChevronRight
                      className={`absolute right-0 top-1/2 shrink-0 -translate-y-1/2 text-gray-500 transition-transform duration-500 ${isOpen ? "rotate-90" : "rotate-0"}`}
                      size={20}
                    />
                  </button>

                  <div
                    id={`faq-answer-${index}`}
                    aria-hidden={!isOpen}
                    inert={!isOpen}
                    className={`grid overflow-hidden transition-all duration-500 ease-[cubic-bezier(.22,1,.36,1)] ${
                      isOpen ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <p className="translate-y-0 text-xs font-medium leading-relaxed text-gray-600 transition-transform duration-500 md:text-sm">
                        {faq.answer}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#1a2a49] bg-[#030f26] text-white">
        <div className="mx-auto grid max-w-7xl gap-7 px-6 py-9 md:grid-cols-[1.15fr_1fr_0.8fr] md:gap-9 md:px-8">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-lg bg-[#E31E24] p-1.5 shadow-lg shadow-red-700/30">
                <Bus size={16} className="text-white" />
              </div>
              <span className="text-3xl font-black italic tracking-tight text-[#ff2f35] md:text-4xl">TURESMA S.A</span>
            </div>
            <p className="max-w-sm text-sm font-medium leading-relaxed text-white/90 md:text-[1.2rem]">
              Transporte turístico premium con base en Manta, sirviendo todo el Ecuador.
            </p>
          </div>

          <div className="md:pl-7">
            <h4 className="mb-4 text-2xl font-black italic uppercase tracking-tight text-yellow-400 md:text-3xl">Contacto</h4>
            <ul className="space-y-2.5 text-sm text-white/95 md:text-[1.1rem]">
              <li className="flex items-center gap-3">
                <Phone size={16} className="text-white/80" />
                <span>{TELEFONO_EMPRESA_DISPLAY}</span>
              </li>
              <li className="flex items-center gap-3">
                <Mail size={16} className="text-white/80" />
                <span>turesmasa@hotmail.com</span>
              </li>
              <li className="flex items-center gap-3">
                <MapPin size={16} className="text-white/80" />
                <span>Manta, Manabí, Ecuador</span>
              </li>
            </ul>
          </div>

          <div className="md:justify-self-end">
            <h4 className="mb-4 text-2xl font-black italic uppercase tracking-tight text-yellow-400 md:text-3xl">Enlaces</h4>
            <div className="flex flex-col gap-2 text-sm font-medium uppercase md:text-[1.1rem]">
              <a href="#nosotros" onClick={(event) => scrollToSection(event, "nosotros")} className="text-white/95 transition-colors hover:text-[#ff2f35]">Nosotros</a>
              <a href="#flota" onClick={(event) => scrollToSection(event, "flota")} className="text-white/95 transition-colors hover:text-[#ff2f35]">Flota</a>
              <a href="#destinos" onClick={(event) => scrollToSection(event, "destinos")} className="text-white/95 transition-colors hover:text-[#ff2f35]">Destinos</a>
              <a href="#servicios" onClick={(event) => scrollToSection(event, "servicios")} className="text-white/95 transition-colors hover:text-[#ff2f35]">Servicios</a>
              <a href="#requerimiento" onClick={(event) => scrollToSection(event, "requerimiento")} className="text-white/95 transition-colors hover:text-[#ff2f35]">Soluciones</a>
              <a href="#contacto" onClick={(event) => scrollToSection(event, "contacto")} className="text-white/95 transition-colors hover:text-[#ff2f35]">Contacto</a>
            </div>
          </div>
        </div>

      </footer>

      {/* BOTONES FLOTANTES */}
      <button
        onClick={() => window.scrollTo({
          top: 0,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        })}
        type="button"
        aria-label="Volver al inicio de la página"
        className={`fixed bottom-8 right-8 z-50 rounded-2xl bg-black p-4 text-white shadow-2xl transition-all hover:bg-[#E31E24] ${showScrollTop ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0"}`}
      >
        <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
      </button>

      <a
        href={`https://wa.me/${TELEFONO_EMPRESA}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Contactar a Turesma por WhatsApp"
        className="fixed bottom-8 left-8 z-50 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#25D366] text-white shadow-2xl transition-transform hover:scale-110 active:scale-95"
      >
        <svg aria-hidden="true" className="h-8 w-8" fill="currentColor" viewBox="0 0 24 24"><path d="M20.52 3.48A11.86 11.86 0 0 0 12.04 0C5.4 0 .01 5.39 0 12.02c0 2.1.55 4.16 1.6 5.98L0 24l6.16-1.58a11.95 11.95 0 0 0 5.85 1.49h.01c6.63 0 12.02-5.39 12.03-12.02 0-3.22-1.25-6.24-3.53-8.41ZM12.02 21.4h-.01a9.4 9.4 0 0 1-4.78-1.3l-.34-.2-3.66.94.98-3.57-.22-.37a9.42 9.42 0 0 1-1.45-5.03c.01-5.21 4.25-9.45 9.47-9.45 2.53 0 4.9.99 6.68 2.77a9.36 9.36 0 0 1 2.77 6.68c-.01 5.22-4.25 9.46-9.44 9.46Zm5.47-7.46c-.3-.15-1.78-.88-2.06-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.95 1.18-.17.2-.35.23-.65.08-.3-.15-1.26-.46-2.4-1.48-.89-.8-1.49-1.78-1.67-2.08-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.53-.08-.15-.68-1.64-.93-2.24-.24-.58-.49-.5-.68-.51h-.58c-.2 0-.53.07-.81.37-.28.3-1.05 1.02-1.05 2.49 0 1.47 1.08 2.89 1.23 3.09.15.2 2.11 3.23 5.11 4.53.71.31 1.26.49 1.69.63.71.23 1.36.19 1.87.11.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.18-1.43-.07-.13-.27-.2-.57-.35Z" /></svg>
      </a>
    </main>
    </LocalizedContent>
  );
}