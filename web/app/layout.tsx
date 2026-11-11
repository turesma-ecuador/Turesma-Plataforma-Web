import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ConfirmProvider } from "../components/confirm-dialog";
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
        <LocaleProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
