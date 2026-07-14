"use client";

import type { ReactNode } from "react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";

import { authClient } from "./auth-client";
import { env } from "./env";

// Create a singleton Convex client
const convex = new ConvexReactClient(env.NEXT_PUBLIC_CONVEX_URL);

interface ConvexClientProviderProps {
  children: ReactNode;
  initialToken?: string | null;
}

export function ConvexClientProvider({
  children,
  initialToken,
}: ConvexClientProviderProps) {
  return (
    <ConvexBetterAuthProvider
      client={convex}
      authClient={authClient}
      initialToken={initialToken}
    >
      {children}
    </ConvexBetterAuthProvider>
  );
}

// Re-export the convex client for direct access if needed
export { convex };
