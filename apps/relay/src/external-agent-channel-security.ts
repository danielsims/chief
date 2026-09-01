import { HttpError } from "./http";

export const EXTERNAL_CHANNEL_AUTHORIZATION_HEADER =
  "x-chief-external-channel-authorization";

export function requireVerifiedEveEndpoint(value: string) {
  const endpoint = new URL(value);
  const hostname = endpoint.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    !(hostname === "vercel.app" || hostname.endsWith(".vercel.app"))
  ) {
    throw new HttpError(
      400,
      "external_agent_endpoint_insecure",
      "Eve channels require an HTTPS endpoint on a verified vercel.app origin.",
    );
  }
}

export async function fetchVerifiedEveEndpoint(
  endpointValue: string,
  init: Omit<RequestInit, "redirect">,
) {
  requireVerifiedEveEndpoint(endpointValue);
  const response = await fetch(endpointValue, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("External channel redirects are not permitted.");
  }
  return response;
}

export async function requireChannelToken(
  request: Request,
  expectedHash: string,
) {
  const authorization =
    request.headers.get(EXTERNAL_CHANNEL_AUTHORIZATION_HEADER) ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const actualHash = await sha256(token);
  if (!token || !constantTimeEqual(actualHash, expectedHash)) {
    throw new HttpError(
      401,
      "external_channel_unauthorized",
      "The external agent channel credential is invalid.",
    );
  }
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

export async function sha256(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
