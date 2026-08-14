import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";

import type { ChiefNavigationApi } from "../lib/chief-navigation-context";
import {
  listenForChiefNavigation,
  routeForChiefDestination,
} from "../lib/app-navigation";
import { ChiefNavigationContext } from "../lib/chief-navigation-context";

let navigationSequence = 0;

export function ChiefNavigationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const open = useCallback<ChiefNavigationApi["open"]>(
    (destination, options) => {
      navigationSequence += 1;
      void navigate(routeForChiefDestination(destination), {
        replace: options?.replace,
        state: {
          ...options?.state,
          chiefNavigationRequestId: navigationSequence,
        },
      });
    },
    [navigate],
  );

  useEffect(
    () => listenForChiefNavigation((destination) => open(destination)),
    [open],
  );

  const value = useMemo(() => ({ open }), [open]);
  return (
    <ChiefNavigationContext.Provider value={value}>
      {children}
    </ChiefNavigationContext.Provider>
  );
}
