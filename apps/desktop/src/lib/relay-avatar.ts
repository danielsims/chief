import { RELAY_URL } from "./config";

/**
 * Profile images are stored as absolute URLs that may point at another relay
 * origin (e.g. a development host). Re-home relay-owned assets onto the relay
 * this client is actually connected to.
 */
export function relayAvatarUrl(image: string | undefined): string | undefined {
  if (!image) return undefined;
  try {
    const url = new URL(image);
    return url.pathname.startsWith("/v1/assets/")
      ? new URL(`${url.pathname}${url.search}`, RELAY_URL).toString()
      : image;
  } catch {
    return image;
  }
}
