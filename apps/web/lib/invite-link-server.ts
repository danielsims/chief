import { z } from "zod";

import { env } from "./env";

const secretPattern = /^[A-Za-z0-9_-]{43,128}$/u;

export function isInviteSecret(value: string): boolean {
  return secretPattern.test(value);
}

const invitePreviewSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  website: z.string().default(""),
  conversationName: z.string().nullable(),
  expiresAt: z.string(),
});

const relayErrorSchema = z.object({
  error: z.object({ code: z.string() }),
});

export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export type InvitePreviewResult =
  | { kind: "ready"; invite: InvitePreview }
  | { kind: "unavailable"; code: string }
  | { kind: "unreachable" };

/** Reads an invite link from the relay, which owns invites and accounts. */
export async function previewInvite(
  workspace: string,
  secret: string,
): Promise<InvitePreviewResult> {
  try {
    const response = await fetch(
      new URL(
        `/v1/workspaces/${encodeURIComponent(workspace)}/invites/preview`,
        env.CHIEF_RELAY_URL,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      },
    );
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = invitePreviewSchema.safeParse(payload);
      return parsed.success
        ? { kind: "ready", invite: parsed.data }
        : { kind: "unreachable" };
    }
    return {
      kind: "unavailable",
      code: relayErrorSchema.safeParse(payload).data?.error.code ?? "",
    };
  } catch {
    return { kind: "unreachable" };
  }
}

/**
 * The sharpest icon a workspace's website declares, mirroring how the apps
 * show a workspace without an uploaded logo. Falls back to /favicon.ico.
 */
export async function websiteIconUrl(website: string): Promise<string | null> {
  const trimmed = website.trim();
  if (!trimmed) return null;
  const origin = URL.parse(
    /^[a-z][a-z\d+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`,
  )?.origin;
  if (!origin?.startsWith("https://")) return null;
  try {
    const response = await fetch(origin, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(2500),
      next: { revalidate: 86_400 },
    });
    if (!response.ok) return `${origin}/favicon.ico`;
    const html = (await response.text()).slice(0, 200_000);
    let best: { href: string; size: number } | null = null;
    for (const [tag] of html.matchAll(/<link\b[^>]*>/giu)) {
      const rel =
        /\brel=["']([^"']+)["']/iu.exec(tag)?.[1]?.toLowerCase() ?? "";
      const href = /\bhref=["']([^"']+)["']/iu.exec(tag)?.[1];
      if (!href || !rel.includes("icon") || rel.includes("mask")) continue;
      const declared = /\bsizes=["'](\d+)x\d+["']/iu.exec(tag)?.[1];
      const size = declared
        ? Number(declared)
        : rel.includes("apple-touch-icon")
          ? 180
          : href.endsWith(".svg")
            ? 512
            : 16;
      const absolute = URL.parse(href.replaceAll("&amp;", "&"), origin);
      if (absolute?.protocol !== "https:") continue;
      if (!best || size > best.size) best = { href: absolute.href, size };
    }
    return best?.href ?? `${origin}/favicon.ico`;
  } catch {
    return `${origin}/favicon.ico`;
  }
}

/** "Expires in 6 days", or "Expires today" on the last day. */
export function expiryLabel(expiresAt: string): string {
  const days = Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000);
  return days <= 1 ? "Expires today" : `Expires in ${days} days`;
}
