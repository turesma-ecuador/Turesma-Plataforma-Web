"use client";

import { Bot, MessageCircleMore, Send, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { LocalizedContent } from "../lib/i18n";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  action?: { label: string; href: string };
};

const quickSuggestions = ["Quiero cotizar un viaje", "¿Cuánto cuesta un Van?", "¿Hay descuentos disponibles?", "¿Dónde veo mis reservas?"];

const faqAnswers = [
  {
    keywords: ["van", "bus", "suv", "minibus", "sedan", "tipo de vehiculo", "tipo de vehículo", "vehicle"],
    answer:
      "Tenemos tarifas diferenciadas por tipo de vehículo: Van, Bus, SUV, Minibus y Sedan. El precio cambia según capacidad, tipo de ruta y si aplica la oferta del día. Puedes verlo en la cotización antes de enviar tu solicitud.",
  },
  {
    keywords: ["oferta", "descuento", "promo", "dia", "del dia", "oferta del dia"],
    answer:
      "La oferta del día depende de la configuración del administrador. Si está activa, se verá reflejada en el cálculo del total y aparecerá como descuento en la estimación.",
  },
  {
    keywords: ["cotizar", "precio", "presupuesto", "valor", "cuanto cuesta", "costo"],
    answer:
      "Para cotizar, completa origen, destino, fecha, pasajeros y tipo de vehículo. El sistema calcula el costo real con los precios vigentes y te muestra una estimación antes de enviar la solicitud.",
  },
  {
    keywords: ["pago", "tarjeta", "metodo", "cuotas", "abonar", "factura"],
    answer:
      "Los pagos se gestionan desde la reserva o la sección de Pagos del cliente. Si quieres revisar una duda sobre un cobro, revisa el detalle de la reserva y el historial antes de pedir ayuda.",
  },
  {
    keywords: ["historial", "viajes", "reservas", "mis viajes", "anteriores"],
    answer:
      "Puedes ver todas tus reservas y viajes en la sección Historial del cliente, donde aparece el estado actual y los datos del servicio.",
  },
  {
    keywords: ["perfil", "datos", "nombre", "telefono", "editar", "modificar"],
    answer:
      "Tu perfil se administra desde la opción Perfil. Desde ahí puedes revisar tus datos personales, imagen y la información asociada a tus viajes y cotizaciones.",
  },
  {
    keywords: ["cancelar", "reprogramar", "cambiar fecha", "modificar reserva", "anular"],
    answer:
      "Si necesitas cambiar o cancelar una reserva, lo mejor es hacerlo desde la reserva activa o comunicarte con el equipo para revisar la fecha y el estado del servicio.",
  },
  {
    keywords: ["estado", "pendiente", "confirmada", "en curso", "cancelada", "aprobada"],
    answer:
      "Los estados indican el avance del servicio: pendiente está en revisión, aprobada o confirmada quedó listo, en curso ya está activo y cancelada fue anulada.",
  },
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getBotReply(input: string): Omit<ChatMessage, "id" | "role"> {
  const cleanInput = normalizeText(input);

  if (!cleanInput) {
    return { text: "Escribe tu consulta y te ayudaré con la información más importante." };
  }

  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(cleanInput)) {
    return {
      text: "¡Hola! Puedo orientarte para cotizar, revisar tus reservas o consultar cómo se calcula el precio. ¿Qué necesitas hacer?",
      action: { label: "Ir a Cotizar", href: "/cliente/cotizar" },
    };
  }

  if (cleanInput.includes("gracias")) {
    return { text: "¡Con gusto! Si necesitas algo más sobre tu viaje o reserva, aquí estoy." };
  }

  if (/(oferta|descuento|promo)/.test(cleanInput)) {
    return {
      text: "No puedo confirmar desde aquí si hay una promoción activa. Si hay un descuento vigente para tu viaje, se mostrará en el desglose de la cotización antes de que la envíes.",
      action: { label: "Consultar cotización", href: "/cliente/cotizar" },
    };
  }

  if (/(precio|cuanto|costo|cotiz|presupuesto|valor)/.test(cleanInput)) {
    return {
      text: "El valor depende del origen, destino, fecha, número de pasajeros y vehículo. No quiero darte un precio aproximado que pueda ser incorrecto: completa esos datos y verás el cálculo vigente antes de enviar la solicitud.",
      action: { label: "Cotizar mi viaje", href: "/cliente/cotizar" },
    };
  }

  if (/(van|bus|suv|minibus|sedan|vehiculo|carro|recomienda|recomendar)/.test(cleanInput)) {
    return {
      text: "La mejor opción depende principalmente del número de pasajeros y la ruta. En Cotizar puedes revisar los vehículos disponibles y su capacidad; si me dices cuántas personas viajan, puedo orientarte sobre qué capacidad buscar.",
      action: { label: "Ver vehículos", href: "/cliente/cotizar" },
    };
  }

  if (/(pago|tarjeta|cuota|abono|factura|cobro)/.test(cleanInput)) {
    return {
      text: "Puedes revisar los pagos y el detalle de cada servicio desde tu historial. Si tienes una duda sobre un cobro específico, ten a mano la reserva relacionada para que el equipo pueda ayudarte.",
      action: { label: "Ver mis reservas", href: "/cliente/historial" },
    };
  }

  if (/(historial|viaje|reserva|mis servicios)/.test(cleanInput)) {
    return {
      text: "En tu historial puedes consultar tus reservas, su estado y los datos del servicio.",
      action: { label: "Abrir historial", href: "/cliente/historial" },
    };
  }

  if (/(perfil|datos|nombre|telefono|editar|modificar)/.test(cleanInput)) {
    return {
      text: "Puedes revisar y actualizar la información de tu cuenta desde Perfil.",
      action: { label: "Ir a mi perfil", href: "/cliente/perfil" },
    };
  }

  if (/(cancelar|reprogramar|cambiar fecha|anular)/.test(cleanInput)) {
    return {
      text: "Las opciones para cambiar o cancelar dependen del estado y la fecha de tu reserva. Revisa primero el servicio en tu historial; si no aparece una opción para gestionarlo, contacta al equipo de Turesma.",
      action: { label: "Buscar mi reserva", href: "/cliente/historial" },
    };
  }

  if (/(estado|pendiente|confirmada|en curso|cancelada|aprobada)/.test(cleanInput)) {
    return {
      text: "El estado muestra en qué etapa está el servicio. Para explicarte el estado de una reserva concreta, revisa el detalle en tu historial.",
      action: { label: "Ver estado de mis reservas", href: "/cliente/historial" },
    };
  }

  if (faqAnswers.some(({ keywords }) => keywords.some((keyword) => cleanInput.includes(normalizeText(keyword))))) {
    return {
      text: "Puedo ayudarte con ese tema, pero necesito un poco más de detalle para orientarte correctamente. ¿Quieres consultar un precio, una reserva o un vehículo?",
      action: { label: "Cotizar mi viaje", href: "/cliente/cotizar" },
    };
  }

  return {
    text: "No tengo suficiente información para responder eso con seguridad. Puedo orientarte sobre cotizaciones, precios, vehículos, pagos, reservas e información de tu perfil.",
    action: { label: "Empezar una cotización", href: "/cliente/cotizar" },
  };
}

export function ClienteChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "¡Hola! Soy tu asistente de Turesma. Puedo ayudarte con cotizaciones, pagos, reservas, historial y perfil. ¿En qué te puedo apoyar?",
    },
  ]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const sendMessage = (value: string) => {
    const text = value.trim();
    if (!text) return;

    const messageId = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `message-${messages.length}`;
    const reply = getBotReply(text);
    const userMessage: ChatMessage = {
      id: `${messageId}-user`,
      role: "user",
      text,
    };

    const assistantMessage: ChatMessage = {
      id: `${messageId}-assistant`,
      role: "assistant",
      ...reply,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <LocalizedContent>
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] right-3 z-50 sm:bottom-4 sm:right-4">
      {isOpen ? (
        <div className="w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.2)]">
          <div className="flex items-center justify-between border-b border-slate-200 bg-[#111827] px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E31E24]">
                <Bot size={18} />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.16em]">Asistente</p>
                <p className="text-[10px] text-slate-300">TURESMA</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Cerrar chatbot"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex max-h-[420px] flex-col gap-3 bg-slate-50 p-3">
            {messages.length === 1 && <div className="flex flex-wrap gap-2">
              {quickSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => sendMessage(suggestion)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-[#E31E24] hover:text-[#E31E24]"
                >
                  {suggestion}
                </button>
              ))}
            </div>}

            <div className="flex max-h-[260px] min-h-[200px] flex-col gap-3 overflow-y-auto pr-1">
              {messages.map((message) => (
                <div
                  key={message.id}
                  data-no-translate={message.role === "user" ? "true" : undefined}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
                    message.role === "assistant"
                      ? "bg-white text-slate-700 border border-slate-200"
                      : "ml-auto bg-[#E31E24] text-white"
                  }`}
                >
                  <p>{message.text}</p>
                  {message.action && (
                    <Link
                      href={message.action.href}
                      className="mt-2 inline-flex rounded-lg bg-[#E31E24] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#c71a20]"
                    >
                      {message.action.label}
                    </Link>
                  )}
                </div>
              ))}
            </div>

            <form
              className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage(input);
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Escribe tu duda..."
                className="flex-1 border-0 bg-transparent px-2 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
              />
              <button
                type="submit"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E31E24] text-white transition hover:bg-[#c71a20]"
                aria-label="Enviar mensaje"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="group flex h-12 w-12 items-center justify-center rounded-full bg-[#111827] p-1 text-white shadow-[0_12px_28px_rgba(17,24,39,0.3)] transition hover:scale-[1.02] hover:bg-[#1f2937] sm:h-auto sm:w-auto sm:gap-3 sm:px-4 sm:py-3 sm:shadow-[0_20px_45px_rgba(17,24,39,0.35)]"
          aria-label="Abrir chatbot"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E31E24] text-white sm:h-11 sm:w-11">
            <MessageCircleMore size={20} />
          </span>
          <span className="hidden sm:flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em]">
            <Sparkles size={14} className="text-yellow-300" />
            Ayuda
          </span>
        </button>
      )}
    </div>
    </LocalizedContent>
  );
}
