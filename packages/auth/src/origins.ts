import type { ChiefAuthOptions } from "./options";

export function trustedOrigins(
  options: Pick<ChiefAuthOptions, "apple" | "baseURL" | "uiOrigin">,
) {
  return [
    options.baseURL,
    options.uiOrigin,
    "chief-desktop://",
    "chief-mobile://",
    "http://localhost:1420",
    "tauri://localhost",
    "https://tauri.localhost",
    ...(options.apple ? ["https://appleid.apple.com"] : []),
  ];
}
