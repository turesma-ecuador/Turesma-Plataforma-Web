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
    description: "Aquí puedes revisar los viajes publicados y el resumen de tus solicitudes y servicios.",
    target: "portal-home-services",
    href: "/cliente",
    icon: LayoutDashboard,
  },
  {
    title: "Cotizar",
    description: "Solicita un servicio a medida o reserva un viaje publicado. La guía de reserva te acompaña por el formulario.",
    target: "portal-cotizar-start",
    href: "/cliente/cotizar",
    icon: FileText,
  },
  {
    title: "Requerimiento especial",
    description: "Solicita varios vehículos, rutas especiales o un servicio para tu organización; el equipo revisará los detalles y responderá con una propuesta.",
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
    description: "Actualiza tus datos de contacto y gestiona la información de tu cuenta y verificación.",
    target: "portal-profile",
    href: "/cliente/perfil",
    icon: UserRound,
  },
];

const BOOKING_STEPS: TourStep[] = [
  {
    title: "Indica tu ruta",
    description: "Marca el origen y el destino en el mapa o búscalos por dirección. El paso siguiente se habilitará cuando ambos puntos estén definidos.",
    target: "booking-route",
    icon: MapPin,
  },
  {
    title: "Elige fecha y pasajeros",
    description: "Selecciona la fecha, horario y cantidad de personas. La disponibilidad final se confirma al revisar tu solicitud.",
    target: "booking-schedule",
    icon: LayoutDashboard,
  },
  {
    title: "Selecciona una categoría",
    description: "Elige el tipo de vehículo que prefieres. Las fotos son referenciales; no estás reservando una unidad o placa específica.",
    target: "booking-category",
    icon: Bus,
  },
  {
    title: "Revisa y envía",
    description: "Confirma los datos del viaje y solicita la cotización. El equipo definirá el precio y podrás revisarlo desde Historial.",
    target: "booking-submit",
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
    const observer = new MutationObserver(refreshBounds);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "hidden", "data-tour-target"],
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", refreshBounds);
    window.addEventListener("scroll", refreshBounds, true);

    return () => {
      active = false;
      clearTimeout(timeout);
      observer.disconnect();
      window.removeEventListener("resize", refreshBounds);
      window.removeEventListener("scroll", refreshBounds, true);
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
    const useTopPanel = bounds ? bounds.top > window.innerHeight / 2 : false;
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
            className="fixed z-[10000] bg-slate-950/65 backdrop-blur-[1px]"
            style={style}
          />
        ))}
        {bounds && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[10001] rounded-xl border-2 border-red-500 shadow-[0_0_0_3px_rgba(227,30,36,0.2)]"
            style={{ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height }}
          />
        )}
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="client-tour-title"
          aria-describedby="client-tour-description"
          className={`fixed left-3 right-3 z-[10002] mx-auto max-h-[42dvh] w-auto max-w-lg overflow-y-auto rounded-3xl border border-white/70 bg-white shadow-2xl sm:left-auto sm:right-6 sm:w-[min(28rem,calc(100vw-3rem))] ${useTopPanel ? "top-3" : "bottom-3"}`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-600">
                {variant === "portal" ? "Ayuda para clientes" : "Guía de reserva"}
              </p>
              <h2 id="client-tour-title" className="mt-1 text-lg font-black tracking-tight text-slate-950 sm:text-xl">
                {currentStep.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={closeTour}
              aria-label="Cerrar recorrido"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
                <StepIcon size={20} aria-hidden="true" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Paso {stepIndex + 1} de {steps.length}
                </p>
                <p id="client-tour-description" className="mt-1 text-sm leading-relaxed text-slate-700">
                  {currentStep.description}
                </p>
              </div>
            </div>

            <div className="flex gap-1.5" aria-hidden="true">
              {steps.map((step, index) => (
                <span key={step.title} className={`h-1.5 flex-1 rounded-full ${index <= stepIndex ? "bg-red-600" : "bg-slate-200"}`} />
              ))}
            </div>

            {variant === "booking" && !stepComplete && (
              <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                Completa la acción resaltada para continuar.
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeTour}
                  className="rounded-xl px-3 py-2.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100"
                >
                  Salir
                </button>
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => moveToStep(stepIndex - 1)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                  >
                    <ArrowLeft size={14} aria-hidden="true" /> Anterior
                  </button>
                )}
              </div>
              {stepIndex < steps.length - 1 ? (
                <button
                  type="button"
                  disabled={variant === "booking" && !stepComplete}
                  onClick={() => moveToStep(stepIndex + 1)}
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Siguiente <ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={variant === "booking" && !stepComplete}
                  onClick={closeTour}
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
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
