export type HostTarget = "cloudflare";

export interface HostSetupDraft {
  apple: boolean;
  appleClientId: string;
  customDomain: string;
  google: boolean;
  googleClientId: string;
  host: HostTarget | null;
  name: string;
}

export const defaultHostSetupDraft: HostSetupDraft = {
  apple: false,
  appleClientId: "",
  customDomain: "",
  google: false,
  googleClientId: "",
  host: null,
  name: "",
};

export function parseRelayName(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/['’]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (slug.length < 2 || slug.length > 40) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) return null;
  return slug;
}

export function hostWorkerName(slug: string): string {
  return slug.endsWith("-chief") ? slug : `${slug}-chief`;
}

export function hostRelayId(slug: string): string {
  return `relay_${slug.replaceAll("-", "_")}`;
}

export function parsePublicHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/\/$/u, "");
  if (!trimmed) return null;
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/") return null;
    if (url.port) return null;
    const hostname = url.hostname;
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      return null;
    }
    if (hostname === "heychief.sh" || hostname.endsWith(".heychief.sh")) {
      return null;
    }
    if (
      !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)+$/u.test(
        hostname,
      )
    ) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

export function hostPublicUrl(draft: Pick<HostSetupDraft, "customDomain">) {
  const hostname = parsePublicHostname(draft.customDomain);
  return hostname ? `https://${hostname}` : "";
}

export function hostAuthOrigin(draft: HostSetupDraft): string {
  const custom = hostPublicUrl(draft);
  if (custom) return custom;
  const slug = parseRelayName(draft.name);
  return slug ? `https://${hostWorkerName(slug)}.workers.dev` : "";
}

export function providerCallbackUrl(
  publicUrl: string,
  provider: "apple" | "google",
): string {
  return `${publicUrl.replace(/\/$/u, "")}/api/auth/callback/${provider}`;
}

export function isHostSetupReady(draft: HostSetupDraft): boolean {
  if (parseRelayName(draft.name) === null) return false;
  if (
    draft.customDomain.trim() !== "" &&
    parsePublicHostname(draft.customDomain) === null
  ) {
    return false;
  }
  const googleReady = draft.google && draft.googleClientId.trim() !== "";
  const appleReady = draft.apple && draft.appleClientId.trim() !== "";
  return googleReady || appleReady;
}

export function canDeployHostSetup(draft: HostSetupDraft): boolean {
  return draft.host === "cloudflare" && isHostSetupReady(draft);
}

export function cloudflareDeployVars(
  draft: HostSetupDraft,
): Record<string, string> {
  const slug = parseRelayName(draft.name);
  if (!slug || draft.host !== "cloudflare") return {};
  const origin = hostAuthOrigin(draft);
  const vars: Record<string, string> = {
    RELAY_DEPLOYMENT: "cloudflare-byoc",
    RELAY_ID: hostRelayId(slug),
    AUTH_BASE_URL: origin,
    AUTH_UI_ORIGIN: origin,
  };
  if (draft.google) {
    vars.GOOGLE_CLIENT_ID = draft.googleClientId.trim();
    vars.AUTH_GOOGLE_REDIRECT_URI = providerCallbackUrl(origin, "google");
  }
  if (draft.apple) {
    vars.APPLE_CLIENT_ID = draft.appleClientId.trim();
    vars.AUTH_APPLE_REDIRECT_URI = providerCallbackUrl(origin, "apple");
  }
  return vars;
}

export function cloudflareSecretNames(
  draft: HostSetupDraft,
): readonly string[] {
  const names = ["BETTER_AUTH_SECRET"];
  if (draft.google) names.push("GOOGLE_CLIENT_SECRET");
  if (draft.apple) names.push("APPLE_CLIENT_SECRET");
  return names;
}

export function cloudflareDeployArgs(draft: HostSetupDraft): string[] {
  const slug = parseRelayName(draft.name);
  if (!slug || draft.host !== "cloudflare") return [];
  return [
    "--name",
    hostWorkerName(slug),
    ...Object.entries(cloudflareDeployVars(draft)).flatMap(([key, value]) => [
      "--var",
      `${key}:${value}`,
    ]),
  ];
}

export function hostRelayConfig(draft: HostSetupDraft) {
  const slug = parseRelayName(draft.name);
  return {
    name: slug,
    workerName: slug ? hostWorkerName(slug) : null,
    publicUrl: hostPublicUrl(draft) || hostAuthOrigin(draft),
    vars: cloudflareDeployVars(draft),
    secrets: cloudflareSecretNames(draft),
    authentication: {
      methods: [
        ...(draft.google ? (["google"] as const) : []),
        ...(draft.apple ? (["apple"] as const) : []),
      ],
    },
  };
}
