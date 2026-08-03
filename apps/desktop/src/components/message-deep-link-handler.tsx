import { useEffect } from "react";
import { useNavigate } from "react-router";

import {
  listenForMessageDeepLinks,
  routeForMessageDeepLink,
} from "../lib/message-deep-links";

export function MessageDeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(
    () =>
      listenForMessageDeepLinks((target) => {
        void navigate(routeForMessageDeepLink(target));
      }),
    [navigate],
  );

  return null;
}
