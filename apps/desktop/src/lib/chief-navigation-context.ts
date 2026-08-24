import { createContext, useContext } from "react";

import type { JsonValue } from "@chief/relay-contracts";

import type { ChiefNavigationDestination } from "./app-navigation";

export type ChiefNavigationState = Record<string, JsonValue>;

export interface ChiefNavigationApi {
  open: (
    destination: ChiefNavigationDestination,
    options?: { replace?: boolean; state?: ChiefNavigationState },
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
