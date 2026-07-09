import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getToken } from "../lib/auth-server";
import { ConvexClientProvider } from "../lib/convex";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marketer",
  description:
    "Your marketing team, as agents. Analytics, content, prospecting and ads, orchestrated by your CMO agent and run locally on your machine.",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const token = await getToken();

  return (
    <html lang="en" className="dark">
      <body>
        <ConvexClientProvider initialToken={token}>
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  );
}
