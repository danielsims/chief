import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Lato } from "next/font/google";

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

export const metadata: Metadata = {
  metadataBase: new URL("https://heychief.sh"),
  title: "Chief: Your marketing team, already at work.",
  description:
    "Proactive specialist agents keep recurring marketing work on schedule and bring results and decisions back for review.",
  openGraph: {
    title: "Chief: Your marketing team, already at work.",
    description:
      "Proactive specialist agents keep marketing work moving and bring results back for review.",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = await getToken();

  return (
    <html lang="en" className={`${lato.variable} ${inter.variable} dark`}>
      <body>
        <ConvexClientProvider initialToken={token}>
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
