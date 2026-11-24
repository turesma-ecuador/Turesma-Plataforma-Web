"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useLocale } from "../../../lib/i18n";
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  CalendarDays,
  CheckCircle2,
  Compass,
  Clock3,
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
  stepHint?: string;
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
    description: "En Inicio puedes ver los viajes publicados y un resumen de tus solicitudes y servicios.",
    target: "portal-home-services",
    href: "/cliente",
    icon: LayoutDashboard,
  },
  {
    title: "Cotizar",
    description: "Solicita un servicio a tu medida o reserva un viaje publicado. Si eliges cotizar, la guía de reserva te acompaña paso a paso.",
    target: "portal-cotizar-start",
    href: "/cliente/cotizar",
    icon: FileText,
  },
  {
    title: "Requerimiento especial",
    description: "Si necesitas varios vehículos o una ruta especial, envía los detalles. Administración revisará la disponibilidad y te enviará una propuesta.",
    target: "portal-custom-request",
    href: "/cliente/requerimiento-personalizado",
    icon: Bus,
  },
  {
    title: "Historial",
    description: "En Historial encontrarás tus reservas, pagos y las actualizaciones de cada servicio.",
    target: "portal-travel-history",
    href: "/cliente/historial",
    icon: History,
  },
  {
    title: "Perfil",
    description: "Mantén al día tus datos de contacto y revisa la información de tu cuenta.",
    target: "portal-profile",
    href: "/cliente/perfil",
    icon: UserRound,
  },
];

const BOOKING_STEPS: TourStep[] = [
  {
    title: "Indica tu ruta",
    description: "Escribe el punto de salida y el destino, o selecciónalos directamente en el mapa.",
    target: "booking-route",
    completionHint: "Selecciona un punto de salida y un destino para continuar.",
    icon: MapPin,
  },
  {
    title: "Elige la fecha del viaje",
    description: "Elige la fecha de salida. Si el servicio dura varios días o incluye un regreso, indica también esas fechas.",
    target: "booking-schedule-calendar",
    completionHint: "Selecciona la fecha del servicio para continuar.",
    icon: CalendarDays,
  },
  {
    title: "Completa horario y pasajeros",
    description: "Indica la hora de salida, la llegada estimada y la cantidad de pasajeros.",
    target: "booking-time-passengers",
    completionHint: "Completa los horarios y la cantidad de personas para continuar.",
    icon: Clock3,
  },
  {
    title: "Selecciona una categoría",
    description: "Elige una categoría de vehículo. Las imágenes son referenciales; la unidad específica se confirma después.",
    target: "booking-category",
    completionHint: "Elige una categoría disponible para continuar.",
    icon: Bus,
  },
  {
    title: "Revisa y envía",
    description: "Revisa los datos antes de enviar la solicitud. Administración definirá el precio y podrás revisarlo en Historial.",
    target: "booking-submit",
    completionHint: "Envía la solicitud para finalizar la guía.",
    icon: CheckCircle2,
  },
];

const TOUR_ENGLISH: Record<string, string> = {
  "Inicio": "Home",
  "En Inicio puedes ver los viajes publicados y un resumen de tus solicitudes y servicios.": "Home shows published trips and a summary of your requests and services.",
  "Cotizar": "Get a quote",
  "Solicita un servicio a tu medida o reserva un viaje publicado. Si eliges cotizar, la guía de reserva te acompaña paso a paso.": "Request a tailored service or book a published trip. If you request a quote, the booking guide will walk you through it.",
  "Requerimiento especial": "Special request",
  "Si necesitas varios vehículos o una ruta especial, envía los detalles. Administración revisará la disponibilidad y te enviará una propuesta.": "For multiple vehicles or a special route, send us the details. Our team will check availability and send you a proposal.",
  "Historial": "History",
  "En Historial encontrarás tus reservas, pagos y las actualizaciones de cada servicio.": "History contains your bookings, payments, and service updates.",
  "Perfil": "Profile",
  "Mantén al día tus datos de contacto y revisa la información de tu cuenta.": "Keep your contact details up to date and review your account information.",
  "Indica tu ruta": "Enter your route",
  "Escribe el punto de salida y el destino, o selecciónalos directamente en el mapa.": "Enter your pickup and destination, or select them directly on the map.",
  "Selecciona un punto de salida y un destino para continuar.": "Select a pickup point and destination to continue.",
  "Marca el origen y agrega al menos un destino al itinerario.": "Set your starting point and add at least one destination to your itinerary.",
  "Marca el punto de salida y el destino en el mapa.": "Set your pickup point and destination on the map.",
  "Elige la fecha del viaje": "Choose your trip dates",
  "Elige la fecha de salida. Si el servicio dura varios días o incluye un regreso, indica también esas fechas.": "Choose your departure date. If your service spans multiple days or includes a return, enter those dates too.",
  "Selecciona la fecha del servicio para continuar.": "Select a service date to continue.",
  "Selecciona la fecha de inicio del servicio.": "Select the service start date.",
  "Indica la fecha estimada de retorno del itinerario.": "Enter the itinerary's estimated return date.",
  "La fecha de retorno no puede ser anterior a la salida.": "The return date cannot be before the departure date.",
  "Las fechas de llegada de cada destino deben estar dentro del período del viaje.": "Each destination's arrival date must be within the trip dates.",
  "Toca también el último día del viaje en el calendario.": "Select the trip's last day on the calendar too.",
  "Selecciona la fecha de recogida para el regreso.": "Select the pickup date for your return.",
  "La fecha de regreso debe ser posterior a la fecha de salida.": "The return date must be after the departure date.",
  "Completa horario y pasajeros": "Add schedule and passengers",
  "Indica la hora de salida, la llegada estimada y la cantidad de pasajeros.": "Enter your departure time, estimated arrival, and passenger count.",
  "Completa los horarios y la cantidad de personas para continuar.": "Enter the schedule and passenger count to continue.",
  "Indica la hora de salida que prefieres.": "Enter your preferred departure time.",
  "Indica una hora estimada de llegada.": "Enter an estimated arrival time.",
  "La llegada estimada debe ser posterior a la salida.": "The estimated arrival must be after departure.",
  "Indica la hora de recogida para el regreso.": "Enter the pickup time for your return.",
  "Selecciona una categoría": "Choose a vehicle category",
  "Elige una categoría de vehículo. Las imágenes son referenciales; la unidad específica se confirma después.": "Choose a vehicle category. Images are illustrative; the specific vehicle will be confirmed later.",
  "Elige una categoría disponible para continuar.": "Choose an available category to continue.",
  "Selecciona una categoría de vehículo disponible.": "Choose an available vehicle category.",
  "Revisa y envía": "Review and submit",
  "Revisa los datos antes de enviar la solicitud. Administración definirá el precio y podrás revisarlo en Historial.": "Review your details before submitting. Our team will set the price for you to review in History.",
  "Envía la solicitud para finalizar la guía.": "Submit your request to finish the guide.",
  "Completa el dato pendiente en el área resaltada para continuar.": "Complete the missing information in the highlighted area to continue.",
  "Cuando termines de revisar los datos, envía la solicitud con el botón al final del formulario.": "After reviewing your details, submit the request using the button at the end of the form.",
  "Recorrido del portal": "Portal tour",
  "Guía de reserva": "Booking guide",
  "Paso": "Step",
  "Siguiente": "Next",
  "Anterior": "Previous",
  "Salir": "Exit",
  "Finalizar": "Finish",
  "Cerrar recorrido": "Close tour",
  "Progreso del recorrido": "Tour progress",
  "Ayuda para clientes": "Customer help",
  "Conoce tu portal Turesma": "Explore your Turesma portal",
  "Te llevaremos por las secciones del portal, desplazándonos hasta cada una y resaltando su función. Puedes salir en cualquier momento o repetir el recorrido desde el botón de ayuda.": "We'll guide you through the portal sections, scrolling to each one and highlighting what it does. You can exit at any time or restart the tour from the help button.",
  "Ahora no": "Not now",
  "Empezar recorrido": "Start tour",
  "Recorrido de navegación": "Navigation tour",
  "Guíame para reservar": "Guide me through booking",
};

const localizeTourText = (text: string, language: "es" | "en") => {
  if (language !== "en") return text;
  const capacity = text.match(/^La categoría seleccionada admite hasta (\d+) pasajeros\. Elige otra categoría\.$/);
  const maxDays = text.match(/^El servicio no puede superar los (\d+) días seguidos\.$/);
  return TOUR_ENGLISH[text]
    || (capacity ? `The selected category accommodates up to ${capacity[1]} passengers. Choose another category.` : undefined)
    || (maxDays ? `The service cannot exceed ${maxDays[1]} consecutive days.` : undefined)
    || text;
};

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
  stepHint,
  onStepChange,
}: ClientGuidedTourProps) {
  const { language } = useLocale();
  const sourceSteps = variant === "portal" ? PORTAL_STEPS : BOOKING_STEPS;
  const steps = useMemo(() => sourceSteps.map((step) => ({
    ...step,
    title: localizeTourText(step.title, language),
    description: localizeTourText(step.description, language),
    completionHint: step.completionHint ? localizeTourText(step.completionHint, language) : undefined,
  })), [language, sourceSteps]);
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(() => variant === "booking" && autoStart);
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
  const TourButtonIcon = variant === "portal" ? Compass : MapPin;

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
      if (attempt === 0) {
        const alignBelowGuide = ["booking-schedule-calendar", "booking-time-passengers"].includes(currentStep.target);
        target.scrollIntoView({
          behavior: "smooth",
          block: alignBelowGuide ? "start" : "center",
          inline: "nearest",
        });
      }
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
    const panelHeight = Math.min(240, window.innerHeight - 24);
    const gap = 12;
    const spaceAbove = bounds ? bounds.top - gap : 0;
    const spaceBelow = bounds ? window.innerHeight - bounds.bottom - gap : 0;
    let panelTop = window.innerHeight - panelHeight - gap;
    if (bounds && variant === "booking" && ["booking-schedule-calendar", "booking-time-passengers"].includes(currentStep.target)) {
      if (spaceAbove >= panelHeight) {
        panelTop = bounds.top - panelHeight - gap;
      } else if (spaceBelow >= panelHeight) {
        panelTop = bounds.bottom + gap;
      } else {
        panelTop = gap;
      }
    } else if (bounds && variant === "booking" && currentStep.target === "booking-route") {
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
            className={`fixed z-[10000] backdrop-blur-0 ${variant === "booking" ? "pointer-events-none bg-slate-950/15" : "bg-slate-950/25"}`}
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
          className="fixed left-1/2 z-[10002] max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-[21rem] -translate-x-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-950/15"
          style={{ left: "50%", top: panelTop }}
        >
          <div className="flex items-start justify-between gap-3 px-3 pt-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
                <StepIcon size={15} aria-hidden="true" />
              </span>
              <div>
                <p className="text-[8px] font-black uppercase tracking-[0.14em] text-red-600">
                  {localizeTourText(variant === "portal" ? "Recorrido del portal" : "Guía de reserva", language)}
                </p>
                <h2 id="client-tour-title" className="text-[13px] font-black leading-tight text-slate-950">
                  {currentStep.title}
                </h2>
                <p className="mt-0.5 text-[9px] font-semibold text-slate-500">
                  {language === "en" ? `Step ${stepIndex + 1} of ${steps.length}` : `Paso ${stepIndex + 1} de ${steps.length}`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeTour}
              aria-label={localizeTourText("Cerrar recorrido", language)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-3 pb-3 pt-1.5">
            <p id="client-tour-description" className="text-[11px] leading-snug text-slate-600">
              {currentStep.description}
            </p>

            <div
              className="mt-2 flex gap-1"
              role="progressbar"
              aria-label={localizeTourText("Progreso del recorrido", language)}
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={stepIndex + 1}
              aria-valuetext={language === "en" ? `Step ${stepIndex + 1} of ${steps.length}` : `Paso ${stepIndex + 1} de ${steps.length}`}
            >
              {steps.map((step, index) => (
                <span key={step.title} className={`h-1 flex-1 rounded-full ${index <= stepIndex ? "bg-red-600" : "bg-slate-200"}`} />
              ))}
            </div>

            {variant === "booking" && !stepComplete && (
              <p role="status" className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-semibold leading-snug text-amber-800">
                {localizeTourText("Completa el dato pendiente en el área resaltada para continuar.", language)}{" "}
                {localizeTourText(stepHint || currentStep.completionHint || "", language)}
              </p>
            )}
            {variant === "booking" && (
              <p className="mt-1 text-[9px] text-slate-500">
                {localizeTourText("Si sales de la guía, tus datos se conservarán.", language)}
              </p>
            )}

            <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeTour}
                  className="rounded-lg px-2 py-1.5 text-[10px] font-bold text-slate-500 transition hover:bg-slate-100"
                >
                  {localizeTourText("Salir", language)}
                </button>
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => moveToStep(stepIndex - 1)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold text-slate-600 transition hover:bg-slate-100"
                  >
                    <ArrowLeft size={13} aria-hidden="true" /> {localizeTourText("Anterior", language)}
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
                  {localizeTourText("Siguiente", language)} <ArrowRight size={13} aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={variant === "booking" && !stepComplete}
                  onClick={closeTour}
                  className="inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[10px] font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                >
                  {localizeTourText("Finalizar", language)} <CheckCircle2 size={15} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </section>
      </>,
      document.body,
    );
  }, [closeTour, currentStep, isOpen, language, mounted, StepIcon, stepComplete, stepHint, stepIndex, steps, targetBounds, variant]);

  return (
    <>
      <button
        type="button"
        onClick={openTour}
        className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-red-700 transition hover:border-red-300 hover:bg-red-100 sm:text-xs"
      >
        <TourButtonIcon size={16} aria-hidden="true" />
        {localizeTourText(variant === "portal" ? "Recorrido del portal" : "Guíame para reservar", language)}
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
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-600">{localizeTourText("Ayuda para clientes", language)}</p>
                <h2 id="client-tour-welcome-title" className="mt-1 text-xl font-black tracking-tight text-slate-950">
                  {localizeTourText("Conoce tu portal Turesma", language)}
                </h2>
              </div>
              <button type="button" onClick={closeTour} aria-label={localizeTourText("Cerrar recorrido", language)} className="rounded-full bg-slate-100 p-2 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950">
              {localizeTourText("Te llevaremos por las secciones del portal, desplazándonos hasta cada una y resaltando su función. Puedes salir en cualquier momento o repetir el recorrido desde el botón de ayuda.", language)}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeTour} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                {localizeTourText("Ahora no", language)}
              </button>
              <button type="button" onClick={openTour} className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white hover:bg-red-700">
                {localizeTourText("Empezar recorrido", language)} <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>
      )}
      {overlay}
    </>
  );
}
