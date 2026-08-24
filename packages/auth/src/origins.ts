import type { ChiefAuthOptions } from "./options";

export function trustedOrigins(
  options: Pick<ChiefAuthOptions, "baseURL" | "uiOrigin">,
) {
  return [
    options.baseURL,
    options.uiOrigin,
    "chief-desktop://",
    "chief-mobile://",
    "http://localhost:1420",
    "tauri://localhost",
    "https://tauri.localhost",
  ];
}
