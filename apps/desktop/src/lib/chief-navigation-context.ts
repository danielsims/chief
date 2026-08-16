import { createContext, useContext } from "react";

import type { ChiefNavigationDestination } from "./app-navigation";

export interface ChiefNavigationApi {
  open: (
    destination: ChiefNavigationDestination,
    options?: { replace?: boolean; state?: Record<string, unknown> },
  ) => void;
}

export const ChiefNavigationContext = createContext<ChiefNavigationApi | null>(
  null,
);

export function useChiefNavigation() {
  const navigation = useContext(ChiefNavigationContext);
  if (!navigation) {
    throw new Error(
      "useChiefNavigation must be used inside ChiefNavigationProvider",
    );
  }
  return navigation;
}
