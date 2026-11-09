import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ConfirmProvider } from "../components/confirm-dialog";
import { LocaleProvider } from "../lib/i18n";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://turesma.com").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: "Transporte turístico y ejecutivo en Manta | Turesma",
  description: "Transporte turístico, ejecutivo y empresarial desde Manta a todo Ecuador. Viaja con Turesma S.A.: seguridad, puntualidad y comodidad.",
  applicationName: "Turesma",
  keywords: [
    "transporte turístico en Manta",
    "transporte ejecutivo en Manta",
    "transporte empresarial en Ecuador",
    "alquiler de buses para turismo",
    "Turesma",
  ],
  alternates: siteUrl ? { canonical: siteUrl } : undefined,
  openGraph: {
    type: "website",
    locale: "es_EC",
    siteName: "Turesma S.A.",
    title: "Transporte turístico y ejecutivo en Manta | Turesma",
    description: "Transporte turístico, ejecutivo y empresarial desde Manta a todo Ecuador.",
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
          {`document.title = "TURESMA S.A | Transporte turístico y ejecutivo en Manta";`}
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
