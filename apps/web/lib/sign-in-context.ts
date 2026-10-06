import { headers } from "next/headers";
import { z } from "zod";

import type { AuthenticationMethod } from "./relay-authentication";
import { env } from "./env";
import { parseAuthenticationMethods } from "./relay-authentication";

export interface SignInAccount {
  name: string;
  email: string;
  image: string | null;
}

export interface SignInWorkspace {
  name: string;
  image: string | null;
}

/**
 * What the sign-in page knows before it reaches the browser. `account` is
 * undefined when the relay could not be asked, so the page falls back to
 * resolving the session client-side instead of guessing "signed out".
 */
export interface SignInContext {
  account: SignInAccount | null | undefined;
  workspace: SignInWorkspace | null;
  methods: readonly AuthenticationMethod[] | null;
}

const sessionSchema = z
  .object({
    user: z.object({
      name: z.string().nullish(),
      email: z.string(),
      image: z.string().nullish(),
    }),
  })
  .nullable();

const organizationsSchema = z.array(
  z.object({ name: z.string(), logo: z.string().nullish() }),
);

/**
 * Reads the visitor's relay session the same way the first-party auth proxy
 * does: the browser's own cookie, forwarded to the fixed relay origin. Nothing
 * here is cached or persisted, and any failure degrades to client resolution.
 */
export async function readSignInContext(): Promise<SignInContext> {
  const forwarded = await forwardedRelayHeaders();
  const [account, methods] = await Promise.all([
    readRelayAccount(forwarded),
    readMethods(),
  ]);
  const workspace = account ? await readWorkspace(forwarded) : null;
  return { account, workspace, methods };
}

/**
 * The browser's own request headers, forwarded to the fixed relay origin. Only
 * the cookie and host surface are copied; nothing is cached or persisted.
 */
export async function forwardedRelayHeaders(): Promise<Headers> {
  const incoming = await headers();
  const cookie = incoming.get("cookie");
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  const proto = incoming.get("x-forwarded-proto") ?? "https";
  const forwarded = new Headers({ accept: "application/json" });
  if (cookie) forwarded.set("cookie", cookie);
  if (host) {
    forwarded.set("x-forwarded-host", host);
    forwarded.set("x-forwarded-proto", proto);
  }
  return forwarded;
}

/** The signed-in relay account, or null when signed out. */
export async function readRelayAccount(
  forwarded: Headers,
): Promise<SignInAccount | null | undefined> {
  if (!forwarded.get("cookie")) return null;
  return readAccount(forwarded);
}

async function readAccount(
  forwarded: Headers,
): Promise<SignInAccount | null | undefined> {
  const payload = await relayJson("/api/auth/get-session", forwarded);
  if (payload === undefined) return undefined;
  const parsed = sessionSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  if (!parsed.data) return null;
  const { user } = parsed.data;
  const name = user.name?.trim() ?? "";
  return {
    name: name.length > 0 ? name : user.email,
    email: user.email,
    image: httpsUrl(user.image),
  };
}

/**
 * The desktop opens whichever workspace its device last used, which the
 * browser cannot know. Only name a workspace when the account has exactly one.
 */
async function readWorkspace(
  forwarded: Headers,
): Promise<SignInWorkspace | null> {
  const parsed = organizationsSchema.safeParse(
    await relayJson("/api/auth/organization/list", forwarded),
  );
  if (!parsed.success || parsed.data.length !== 1) return null;
  const [workspace] = parsed.data;
  return workspace
    ? { name: workspace.name, image: httpsUrl(workspace.logo) }
    : null;
}

async function readMethods(): Promise<AuthenticationMethod[] | null> {
  const payload = await relayJson(
    "/.well-known/relay",
    new Headers({ accept: "application/json" }),
  );
  try {
    return payload === undefined ? null : parseAuthenticationMethods(payload);
  } catch {
    return null;
  }
}

export async function relayJson(path: string, forwarded: Headers) {
  try {
    const response = await fetch(new URL(path, env.CHIEF_RELAY_URL), {
      headers: forwarded,
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return undefined;
    const payload: unknown = await response.json();
    return payload;
  } catch {
    return undefined;
  }
}

function httpsUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
