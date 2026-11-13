import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ConfirmProvider } from "../components/confirm-dialog";
import { SessionActivityMonitor } from "../components/session-activity-monitor";
import { LocaleProvider } from "../lib/i18n";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://turesma.com").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: "TURESMA S.A. | Transporte turístico y ejecutivo en Manta",
  description: "Transporte turístico, ejecutivo, empresarial y logístico desde Manta a todo Ecuador. Solicita tu cotización con Turesma S.A.",
  applicationName: "Turesma",
  icons: {
    icon: "/favicon.png",
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
  keywords: [
    "transporte turístico en Manta",
    "transporte ejecutivo en Manta",
    "transporte empresarial en Ecuador",
    "alquiler de buses para turismo",
    "transporte logístico en Manta",
    "tours turísticos en Ecuador",
    "traslados al aeropuerto de Manta",
    "Turesma",
  ],
  alternates: siteUrl ? { canonical: siteUrl } : undefined,
  openGraph: {
    type: "website",
    locale: "es_EC",
    siteName: "Turesma S.A.",
    title: "TURESMA S.A. | Transporte turístico y ejecutivo en Manta",
    description: "Transporte turístico, ejecutivo, empresarial y logístico desde Manta a todo Ecuador.",
    url: siteUrl,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body suppressHydrationWarning>
        <Script id="tab-title" strategy="beforeInteractive">
          {`document.title = "TURESMA S.A. | Transporte turístico y ejecutivo en Manta";`}
        </Script>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "LocalBusiness",
              name: "Turesma S.A.",
              description: "Servicios de transporte turístico, ejecutivo y empresarial desde Manta, Ecuador.",
              telephone: "+593993570061",
              email: "turesmasa@hotmail.com",
              address: {
                "@type": "PostalAddress",
                addressLocality: "Manta",
                addressRegion: "Manabí",
                addressCountry: "EC",
              },
              areaServed: [
                { "@type": "City", name: "Manta" },
                { "@type": "Country", name: "Ecuador" },
              ],
                hasOfferCatalog: {
                  "@type": "OfferCatalog",
                  name: "Servicios de transporte Turesma",
                  itemListElement: [
                    "Transporte turístico",
                    "Transporte ejecutivo",
                    "Transporte empresarial",
                    "Alquiler de buses",
                    "Traslados al aeropuerto",
                    "Transporte para eventos",
                    "Transporte logístico",
                    "Tours turísticos",
                  ].map((name) => ({
                    "@type": "Offer",
                    itemOffered: { "@type": "Service", name },
                  })),
                },
              ...(siteUrl ? { url: siteUrl, logo: `${siteUrl}/logo.png` } : {}),
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: "¿Cómo hago una reserva?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Puedes reservar por medio de nuestro sistema web, WhatsApp o con un asesor. Solo necesitamos fecha, hora, origen, destino y cantidad de pasajeros para confirmar tu unidad.",
                  },
                },
                {
                  "@type": "Question",
                  name: "¿Atienden viajes dentro y fuera de Manta?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Sí. Operamos en Manta y realizamos traslados a nivel provincial y nacional, según disponibilidad y planificación de ruta.",
                  },
                },
                {
                  "@type": "Question",
                  name: "¿Cómo elijo el vehículo adecuado para mi viaje?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "La mejor opción depende del número de pasajeros, el equipaje y el tipo de recorrido. Al cotizar, cuéntanos esos detalles y te ayudaremos a elegir el vehículo adecuado.",
                  },
                },
                {
                  "@type": "Question",
                  name: "¿Puedo pedir una cotización antes de reservar?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Claro. Te enviamos una cotización previa sin compromiso para que conozcas tarifas, condiciones y tiempos estimados.",
                  },
                },
                {
                  "@type": "Question",
                  name: "¿Ofrecen transporte turístico para grupos?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Sí. Ofrecemos transporte turístico para grupos desde Manta hacia destinos de Manabí y todo Ecuador. La unidad se coordina según la cantidad de pasajeros y las características del recorrido.",
                  },
                },
                {
                  "@type": "Question",
                  name: "¿Realizan traslados ejecutivos desde Manta?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Sí. Realizamos traslados ejecutivos, corporativos, al aeropuerto y entre ciudades, con planificación previa para cada servicio.",
                  },
                },
                {
                  "@type": "Question",
                  name: "¿Ofrecen transporte para empresas y eventos?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Sí. Coordinamos soluciones de transporte para empresas, congresos, bodas, eventos institucionales, grupos turísticos y recorridos especiales.",
                  },
                },
                {
                  "@type": "Question",
                  name: "¿Qué alternativas de transporte tienen disponibles?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Contamos con autos, camionetas, SUV, vans, minibuses y buses, sujetos a disponibilidad y al número de pasajeros.",
                  },
                },
                {
                  "@type": "Question",
                  name: "¿A qué destinos realizan traslados?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Operamos desde Manta hacia destinos de Manabí y otras ciudades del Ecuador. Revisamos cada ruta, fecha y disponibilidad al momento de preparar la cotización.",
                  },
                },
                {
                  "@type": "Question",
                  name: "¿Qué información necesito para solicitar una cotización?",
                  acceptedAnswer: {
                    "@type": "Answer",
                    text: "Solo necesitamos la fecha, hora, origen, destino y cantidad de pasajeros. También puedes indicarnos si llevarás equipaje o si se trata de un evento o recorrido especial.",
                  },
                },
              ],
            }),
          }}
        />
        <LocaleProvider>
          <ConfirmProvider>
            <SessionActivityMonitor />
            {children}
          </ConfirmProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
