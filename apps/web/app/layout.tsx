import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Lato } from "next/font/google";
import localFont from "next/font/local";

import { getToken } from "../lib/auth-server";
import { ConvexClientProvider } from "../lib/convex";

import "./globals.css";

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-slack",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-openai-fallback",
  display: "swap",
});

const geistPixel = localFont({
  src: "../../desktop/src/assets/fonts/GeistPixel-Square.woff2",
  variable: "--font-pixel",
  display: "swap",
  weight: "400 700",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://heychief.sh"),
  title: "Chief: Your team of agents, already at work.",
  description:
    "A coordinated team of specialist agents keeps recurring work moving and brings useful results and real decisions back for review.",
  openGraph: {
    title: "Chief: Your team of agents, already at work.",
    description:
      "Specialist agents work together, keep recurring work moving and bring results back for review.",
    url: "/",
    siteName: "Chief",
    images: [
      {
        url: "/brand/chief-social-card.png",
        width: 1600,
        height: 800,
        alt: "Chief",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Chief: Your team of agents, already at work.",
    description:
      "Specialist agents work together, keep recurring work moving and bring results back for review.",
    images: ["/brand/chief-social-card.png"],
  },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = await getToken();

  return (
    <html
      lang="en"
      className={`${lato.variable} ${inter.variable} ${geistPixel.variable} dark`}
    >
      <body>
        <ConvexClientProvider initialToken={token}>
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
