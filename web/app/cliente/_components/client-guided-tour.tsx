"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bus,
  CheckCircle2,
  CircleHelp,
  FileText,
  History,
  LayoutDashboard,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

type TourVariant = "portal" | "booking";

type TourStep = {
  title: string;
  description: string;
  href?: string;
  icon: LucideIcon;
};

type ClientGuidedTourProps = {
  variant: TourVariant;
  autoStart?: boolean;
};

const PORTAL_TOUR_SEEN_KEY = "turesma_cliente_portal_tour_v1";
const PORTAL_TOUR_PREFERENCE_EVENT = "turesma:client-portal-tour-preference";

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
    description: "Consulta el resumen de tus solicitudes, viajes disponibles y el seguimiento de tu próximo servicio.",
    href: "/cliente",
    icon: LayoutDashboard,
  },
  {
    title: "Cotizar",
    description: "Pide el precio de un servicio o reserva uno de los viajes publicados directamente desde la plataforma.",
    href: "/cliente/cotizar",
    icon: FileText,
  },
  {
    title: "Requerimiento especial",
    description: "Úsalo para grupos grandes, varios vehículos, rutas múltiples, horarios escalonados u otros servicios que requieren coordinación.",
    href: "/cliente/requerimiento-personalizado",
    icon: Bus,
  },
  {
    title: "Historial",
    description: "Revisa el estado de tus reservas, pagos y viajes. Cuando se asigne una unidad, aquí verás sus datos y podrás contactar al conductor.",
    href: "/cliente/historial",
    icon: History,
  },
  {
    title: "Perfil",
    description: "Mantén actualizados tu nombre y datos de contacto para que el equipo pueda atenderte correctamente.",
    href: "/cliente/perfil",
    icon: UserRound,
  },
];

const BOOKING_STEPS: TourStep[] = [
  {
    title: "Elige cómo empezar",
    description: "Puedes reservar un viaje publicado con precio definido o iniciar una nueva solicitud para que Turesma prepare una cotización.",
    icon: FileText,
  },
  {
    title: "Completa ruta y horario",
    description: "Indica origen, destino, fecha, hora y cantidad de pasajeros. El mapa te ayuda a precisar el punto de salida.",
    icon: LayoutDashboard,
  },
  {
    title: "Selecciona una categoría",
    description: "Elige el tipo de vehículo que prefieres. Las fotos son referenciales: todavía no seleccionas una unidad ni una placa específica.",
    icon: Bus,
  },
  {
    title: "Revisa la propuesta y continúa",
    description: "En una cotización, el equipo revisa el servicio y te informa el precio para que lo aceptes y pagues desde Historial. Despacho asigna el vehículo después de confirmar el pago.",
    href: "/cliente/historial",
    icon: CheckCircle2,
  },
];

export function ClientGuidedTour({ variant, autoStart = false }: ClientGuidedTourProps) {
  const steps = variant === "portal" ? PORTAL_STEPS : BOOKING_STEPS;
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const portalTourSeen = useSyncExternalStore(
    subscribeToPortalTourPreference,
    getPortalTourSeen,
    () => true,
  );
  const showWelcome = variant === "portal" && autoStart && !portalTourSeen && !isOpen;

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
    markPortalTourSeen();
  }, [markPortalTourSeen]);

  useEffect(() => {
    if (!isOpen && !showWelcome) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTour();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeTour, isOpen, showWelcome]);

  const startTour = () => {
    setStepIndex(0);
    setIsOpen(true);
    markPortalTourSeen();
  };

  const openTour = () => {
    setStepIndex(0);
    setIsOpen(true);
  };

  const currentStep = steps[stepIndex];
  const StepIcon = currentStep.icon;

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

      {(isOpen || showWelcome) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/65 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-tour-title"
            aria-describedby="client-tour-description"
            className="my-auto w-full max-w-lg overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-red-600">
                  {variant === "portal" ? "Ayuda para clientes" : "Guía de reserva"}
                </p>
                <h2 id="client-tour-title" className="mt-1 text-xl font-black tracking-tight text-slate-950 sm:text-2xl">
                  {showWelcome ? "Conoce tu portal Turesma" : currentStep.title}
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

            {showWelcome ? (
              <div className="space-y-5 p-5 sm:p-6">
                <div className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <CircleHelp size={20} className="mt-0.5 shrink-0 text-blue-700" aria-hidden="true" />
                  <p id="client-tour-description" className="text-sm leading-relaxed text-blue-950">
                    Te mostramos para qué sirve cada sección del portal. Es un recorrido breve y puedes repetirlo cuando quieras desde el botón de ayuda.
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeTour}
                    className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                  >
                    Ahora no
                  </button>
                  <button
                    type="button"
                    onClick={startTour}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700"
                  >
                    Empezar recorrido <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5 p-5 sm:p-6">
                <div className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700">
                    <StepIcon size={21} aria-hidden="true" />
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
                    <span
                      key={step.title}
                      className={`h-1.5 flex-1 rounded-full ${index <= stepIndex ? "bg-red-600" : "bg-slate-200"}`}
                    />
                  ))}
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
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
                        onClick={() => setStepIndex((current) => current - 1)}
                        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        <ArrowLeft size={14} aria-hidden="true" /> Anterior
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    {currentStep.href && (
                      <Link
                        href={currentStep.href}
                        onClick={closeTour}
                        className="rounded-xl border border-slate-200 px-3 py-2.5 text-center text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                      >
                        Abrir sección
                      </Link>
                    )}
                    {stepIndex < steps.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => setStepIndex((current) => current + 1)}
                        className="inline-flex items-center justify-center gap-1 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-red-700"
                      >
                        Siguiente <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={closeTour}
                        className="inline-flex items-center justify-center gap-1 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-red-700"
                      >
                        Finalizar <CheckCircle2 size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
