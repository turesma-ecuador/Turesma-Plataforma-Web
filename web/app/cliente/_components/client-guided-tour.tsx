"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  CheckCircle2,
  CircleHelp,
  FileText,
  History,
  LayoutDashboard,
  MapPin,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

type TourVariant = "portal" | "booking";

type TourStep = {
  title: string;
  description: string;
  target: string;
  completionHint?: string;
  href?: string;
  icon: LucideIcon;
};

type ClientGuidedTourProps = {
  variant: TourVariant;
  autoStart?: boolean;
  stepComplete?: boolean;
  onStepChange?: (stepIndex: number) => void;
};

const PORTAL_TOUR_SEEN_KEY = "turesma_cliente_portal_tour_v1";
const PORTAL_TOUR_PREFERENCE_EVENT = "turesma:client-portal-tour-preference";
const subscribeToClientHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

const subscribeToPortalTourPreference = (onChange: () => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  window.addEventListener(PORTAL_TOUR_PREFERENCE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PORTAL_TOUR_PREFERENCE_EVENT, onChange);
  };
};

const getPortalTourSeen = () => {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PORTAL_TOUR_SEEN_KEY) === "true";
  } catch (storageError) {
    console.error("No se pudo consultar si el recorrido del portal ya fue mostrado:", storageError);
    return false;
  }
};

const PORTAL_STEPS: TourStep[] = [
  {
    title: "Inicio",
    description: "Consulta los viajes publicados y el resumen de tus solicitudes y servicios.",
    target: "portal-home-services",
    href: "/cliente",
    icon: LayoutDashboard,
  },
  {
    title: "Cotizar",
    description: "Solicita un servicio o reserva un viaje publicado. La guía de reserva te acompaña por el formulario.",
    target: "portal-cotizar-start",
    href: "/cliente/cotizar",
    icon: FileText,
  },
  {
    title: "Requerimiento especial",
    description: "Solicita varios vehículos o un servicio especial; el equipo revisará los detalles y te enviará una propuesta.",
    target: "portal-custom-request",
    href: "/cliente/requerimiento-personalizado",
    icon: Bus,
  },
  {
    title: "Historial",
    description: "Consulta tus reservas, pagos y viajes, y revisa aquí las actualizaciones de cada servicio.",
    target: "portal-travel-history",
    href: "/cliente/historial",
    icon: History,
  },
  {
    title: "Perfil",
    description: "Actualiza tus datos de contacto y revisa la información de tu cuenta.",
    target: "portal-profile",
    href: "/cliente/perfil",
    icon: UserRound,
  },
];

const BOOKING_STEPS: TourStep[] = [
  {
    title: "Indica tu ruta",
    description: "Busca salida y destino o marca ambos puntos en el mapa.",
    target: "booking-route",
    completionHint: "Selecciona origen y destino para continuar.",
    icon: MapPin,
  },
  {
    title: "Elige fecha y pasajeros",
    description: "Elige fecha, horario y pasajeros. La disponibilidad se confirma al revisar tu solicitud.",
    target: "booking-schedule",
    completionHint: "Completa fecha, hora y cantidad de pasajeros.",
    icon: LayoutDashboard,
  },
  {
    title: "Selecciona una categoría",
    description: "Elige una categoría. Las fotos son referenciales; no reservas una unidad específica.",
    target: "booking-category",
    completionHint: "Elige una categoría disponible para continuar.",
    icon: Bus,
  },
  {
    title: "Revisa y envía",
    description: "Revisa los datos y envía la solicitud. El equipo definirá el precio para que lo revises desde Historial.",
    target: "booking-submit",
    completionHint: "Envía la solicitud para finalizar la guía.",
    icon: CheckCircle2,
  },
];

function findVisibleTarget(selector: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour-target="${selector}"]`))
    .find((element) => element.getClientRects().length > 0);
}

function getTargetBounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const padding = 8;
  const top = Math.max(0, rect.top - padding);
  const left = Math.max(0, rect.left - padding);
  const right = Math.min(window.innerWidth, rect.right + padding);
  const bottom = Math.min(window.innerHeight, rect.bottom + padding);
  return {
    top,
    left,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function ClientGuidedTour({
  variant,
  autoStart = false,
  stepComplete = true,
  onStepChange,
}: ClientGuidedTourProps) {
  const steps = variant === "portal" ? PORTAL_STEPS : BOOKING_STEPS;
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const mounted = useSyncExternalStore(subscribeToClientHydration, getClientHydrationSnapshot, getServerHydrationSnapshot);
  const [targetBounds, setTargetBounds] = useState<{ selector: string; bounds: ReturnType<typeof getTargetBounds> } | null>(null);
  const portalTourSeen = useSyncExternalStore(
    subscribeToPortalTourPreference,
    getPortalTourSeen,
    () => true,
  );
  const showWelcome = variant === "portal" && autoStart && !portalTourSeen && !isOpen;
  const currentStep = steps[stepIndex];
  const StepIcon = currentStep.icon;

  const markPortalTourSeen = useCallback(() => {
    if (variant !== "portal") return;
    try {
      window.localStorage.setItem(PORTAL_TOUR_SEEN_KEY, "true");
      window.dispatchEvent(new Event(PORTAL_TOUR_PREFERENCE_EVENT));
    } catch (storageError) {
      console.error("No se pudo guardar que el recorrido del portal fue mostrado:", storageError);
    }
  }, [variant]);

  const closeTour = useCallback(() => {
    setIsOpen(false);
    setTargetBounds(null);
    markPortalTourSeen();
  }, [markPortalTourSeen]);

  useEffect(() => {
    if (!isOpen) return;
    onStepChange?.(stepIndex);
  }, [isOpen, onStepChange, stepIndex]);

  useEffect(() => {
    if (variant !== "portal" || !isOpen || !currentStep.href || pathname === currentStep.href) return;
    router.push(currentStep.href);
  }, [currentStep.href, isOpen, pathname, router, variant]);

  useEffect(() => {
    if (!isOpen || (variant === "portal" && pathname !== currentStep.href)) return;

    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    let refreshFrame: number | null = null;
    const refreshBounds = () => {
      const target = findVisibleTarget(currentStep.target);
      if (!target) {
        setTargetBounds((current) => current?.selector === currentStep.target ? null : current);
        return;
      }
      const bounds = getTargetBounds(target);
      setTargetBounds((current) => {
        if (
          current?.selector === currentStep.target
          && current.bounds.top === bounds.top
          && current.bounds.left === bounds.left
          && current.bounds.width === bounds.width
          && current.bounds.height === bounds.height
        ) return current;
        return { selector: currentStep.target, bounds };
      });
    };
    const scheduleRefreshBounds = () => {
      if (refreshFrame !== null) return;
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = null;
        if (active) refreshBounds();
      });
    };
    const locateTarget = (attempt = 0) => {
      const target = findVisibleTarget(currentStep.target);
      if (!target) {
        if (attempt < 30) timeout = setTimeout(() => locateTarget(attempt + 1), 100);
        else setTargetBounds((current) => current?.selector === currentStep.target ? null : current);
        return;
      }
      if (attempt === 0) target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      timeout = setTimeout(() => {
        if (active) refreshBounds();
      }, attempt === 0 ? 250 : 0);
    };

    locateTarget();
    const observer = new MutationObserver((mutations) => {
      const hasRelevantMutation = mutations.some(({ target }) => {
        if (currentStep.target !== "booking-route") return true;
        const element = target instanceof Element ? target : target.parentElement;
        return !element?.closest('[data-tour-target="booking-route"]');
      });
      if (hasRelevantMutation) scheduleRefreshBounds();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "hidden", "data-tour-target"],
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", scheduleRefreshBounds);
    window.addEventListener("scroll", scheduleRefreshBounds, true);

    return () => {
      active = false;
      clearTimeout(timeout);
      if (refreshFrame !== null) window.cancelAnimationFrame(refreshFrame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleRefreshBounds);
      window.removeEventListener("scroll", scheduleRefreshBounds, true);
    };
  }, [currentStep.target, currentStep.href, isOpen, pathname, variant]);

  useEffect(() => {
    if (!isOpen && !showWelcome) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTour();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeTour, isOpen, showWelcome]);

  const openTour = () => {
    setStepIndex(0);
    setIsOpen(true);
    if (variant === "portal") markPortalTourSeen();
  };

  const moveToStep = (nextStep: number) => {
    setTargetBounds(null);
    setStepIndex(nextStep);
  };

  const overlay = useMemo(() => {
    if (!isOpen || !mounted) return null;
    const bounds = targetBounds?.selector === currentStep.target ? targetBounds.bounds : null;
    const panelHeight = Math.min(180, window.innerHeight - 24);
    const gap = 12;
    const spaceAbove = bounds ? bounds.top - gap : 0;
    const spaceBelow = bounds ? window.innerHeight - bounds.bottom - gap : 0;
    let panelTop = window.innerHeight - panelHeight - gap;
    if (bounds && variant === "booking" && currentStep.target === "booking-route") {
      if (spaceBelow >= panelHeight) {
        panelTop = bounds.bottom + gap;
      } else if (spaceAbove >= panelHeight) {
        panelTop = bounds.top - panelHeight - gap;
      } else if (spaceAbove > spaceBelow) {
        panelTop = gap;
      }
    } else if (bounds && spaceBelow >= panelHeight) {
      panelTop = bounds.bottom + gap;
    } else if (bounds && spaceAbove >= panelHeight) {
      panelTop = bounds.top - panelHeight - gap;
    } else if (bounds && spaceAbove > spaceBelow) {
      panelTop = gap;
    }
    const blockers = bounds ? [
      { top: 0, left: 0, width: window.innerWidth, height: bounds.top },
      { top: bounds.bottom, left: 0, width: window.innerWidth, height: window.innerHeight - bounds.bottom },
      { top: bounds.top, left: 0, width: bounds.left, height: bounds.height },
      { top: bounds.top, left: bounds.right, width: window.innerWidth - bounds.right, height: bounds.height },
    ] : [];

    return createPortal(
      <>
        {blockers.map((style, index) => (
          <div
            key={index}
            aria-hidden="true"
            className={`fixed z-[10000] backdrop-blur-[1px] ${variant === "booking" ? "pointer-events-none bg-slate-950/35" : "bg-slate-950/55"}`}
            style={style}
          />
        ))}
        {bounds && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[10001] rounded-xl border-2 border-red-500/80 shadow-[0_0_0_3px_rgba(227,30,36,0.12)]"
            style={{ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height }}
          />
        )}
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="client-tour-title"
          aria-describedby="client-tour-description"
          className="fixed left-1/2 z-[10002] w-[calc(100vw-1.5rem)] max-w-[21rem] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-950/15"
          style={{ left: "50%", top: panelTop }}
        >
          <div className="flex items-start justify-between gap-3 px-3 pt-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
                <StepIcon size={15} aria-hidden="true" />
              </span>
              <div>
                <p className="text-[8px] font-black uppercase tracking-[0.14em] text-red-600">
                  {variant === "portal" ? "Recorrido del portal" : `Paso ${stepIndex + 1} de ${steps.length}`}
                </p>
                <h2 id="client-tour-title" className="text-[13px] font-black leading-tight text-slate-950">
                  {currentStep.title}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={closeTour}
              aria-label="Cerrar recorrido"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-3 pb-3 pt-1.5">
            <p id="client-tour-description" className="text-[11px] leading-snug text-slate-600">
              {currentStep.description}
            </p>

            <div className="mt-2 flex gap-1" aria-hidden="true">
              {steps.map((step, index) => (
                <span key={step.title} className={`h-1 flex-1 rounded-full ${index <= stepIndex ? "bg-red-600" : "bg-slate-200"}`} />
              ))}
            </div>

            {variant === "booking" && !stepComplete && (
              <p role="status" className="mt-1.5 text-[10px] font-semibold text-amber-700">
                {currentStep.completionHint}
              </p>
            )}

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeTour}
                  className="rounded-lg px-2 py-1.5 text-[10px] font-bold text-slate-500 transition hover:bg-slate-100"
                >
                  Salir
                </button>
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => moveToStep(stepIndex - 1)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold text-slate-600 transition hover:bg-slate-100"
                  >
                    <ArrowLeft size={13} aria-hidden="true" /> Anterior
                  </button>
                )}
              </div>
              {stepIndex < steps.length - 1 ? (
                <button
                  type="button"
                  disabled={variant === "booking" && !stepComplete}
                  onClick={() => moveToStep(stepIndex + 1)}
                  className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[10px] font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                >
                  Siguiente <ArrowRight size={13} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={variant === "booking" && !stepComplete}
                  onClick={closeTour}
                  className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[10px] font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                >
                  Finalizar <CheckCircle2 size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </section>
      </>,
      document.body,
    );
  }, [closeTour, currentStep, isOpen, mounted, StepIcon, stepComplete, stepIndex, steps, targetBounds, variant]);

  return (
    <>
      <button
        type="button"
        onClick={openTour}
        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-red-700 transition hover:border-red-300 hover:bg-red-100 sm:text-xs"
      >
        <CircleHelp size={16} aria-hidden="true" />
        {variant === "portal" ? "Recorrido del portal" : "Guíame para reservar"}
      </button>
      {variant === "portal" && showWelcome && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto bg-slate-950/65 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-tour-welcome-title"
            className="my-auto w-full max-w-lg rounded-3xl border border-white/70 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-600">Ayuda para clientes</p>
                <h2 id="client-tour-welcome-title" className="mt-1 text-xl font-black tracking-tight text-slate-950">
                  Conoce tu portal Turesma
                </h2>
              </div>
              <button type="button" onClick={closeTour} aria-label="Cerrar recorrido" className="rounded-full bg-slate-100 p-2 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950">
              Te llevaremos por las secciones del portal, desplazándonos hasta cada una y resaltando su función. Puedes salir en cualquier momento o repetir el recorrido desde el botón de ayuda.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeTour} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Ahora no
              </button>
              <button type="button" onClick={openTour} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white hover:bg-red-700">
                Empezar recorrido <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>
      )}
      {overlay}
    </>
  );
}
