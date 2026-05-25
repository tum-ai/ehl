import type { Metadata } from "next";
import localFont from "next/font/local";
import { JetBrains_Mono, Anton, Manrope } from "next/font/google";
import { AutoRefresh } from "@/components/auto-refresh";
import "./globals.css";

const satoshi = localFont({
  src: [
    { path: "../fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
    { path: "../fonts/Satoshi-Black.woff2", weight: "900", style: "normal" },
    { path: "../fonts/Satoshi-Italic.woff2", weight: "400", style: "italic" },
    { path: "../fonts/Satoshi-BoldItalic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const horizon = localFont({
  src: [{ path: "../fonts/Horizon-Bold.otf", weight: "700", style: "normal" }],
  variable: "--font-horizon",
  display: "swap",
});

const anton = Anton({
  weight: "400",
  variable: "--font-anton",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "European Hackathon League",
    template: "%s | EHL",
  },
  description:
    "Europe's first competitive hackathon league. Matches across Europe. One leaderboard. One champion.",
  metadataBase: new URL("https://ehl.gg"),
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "European Hackathon League",
    title: "European Hackathon League",
    description:
      "Europe's first competitive hackathon league. Matches across Europe. One leaderboard. One champion.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "European Hackathon League",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "European Hackathon League",
    description:
      "Europe's first competitive hackathon league. Matches across Europe. One leaderboard. One champion.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${satoshi.variable} ${jetbrainsMono.variable} ${horizon.variable} ${anton.variable} ${manrope.variable} font-sans antialiased`}
      >
        {children}
        <AutoRefresh />
      </body>
    </html>
  );
}
