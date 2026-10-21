import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

import type { RelayClient } from "@chief/relay-client";
import type { WebMachinePolicy } from "@chief/relay-contracts";
import { webMachinePolicySchema } from "@chief/relay-contracts";

/**
 * Whether this computer lends its connection to a workspace's agents, and to
 * whom. It's a choice about this machine, so it lives here rather than on the
 * relay, and it's off until the member turns it on.
 */
const changed = "chief:web-machine-changed";
const storageKey = (workspaceId: string) => `chief:web-machine:${workspaceId}`;

/** The policy this machine lends under, or null when it isn't lending. */
export function webMachinePolicy(workspaceId: string): WebMachinePolicy | null {
  try {
    const stored = window.localStorage.getItem(storageKey(workspaceId));
    if (!stored) return null;
    const policy = webMachinePolicySchema.safeParse(JSON.parse(stored));
    // A setting saved by an older version stays on, for the owner's agents.
    return policy.success ? policy.data : { allow: "mine" };
  } catch {
    return null;
  }
}

export function setWebMachinePolicy(
  workspaceId: string,
  policy: WebMachinePolicy | null,
) {
  try {
    if (policy)
      window.localStorage.setItem(
        storageKey(workspaceId),
        JSON.stringify(policy),
      );
    else window.localStorage.removeItem(storageKey(workspaceId));
  } catch {
    // Without storage the choice lasts until the app closes.
  }
  window.dispatchEvent(new Event(changed));
}

export function useWebMachinePolicy(workspaceId: string | undefined) {
  const stored = useSyncExternalStore(
    (notify) => {
      window.addEventListener(changed, notify);
      return () => window.removeEventListener(changed, notify);
    },
    () =>
      workspaceId
        ? (window.localStorage.getItem(storageKey(workspaceId)) ?? "")
        : "",
  );
  return stored && workspaceId ? webMachinePolicy(workspaceId) : null;
}

/**
 * What agents have used this machine for: which agent, for whom, which site,
 * and when. It never leaves this computer, and holds only the site, not the
 * page, so the owner can see who uses their connection without reading what
 * they read.
 */
const webMachineVisitSchema = z.object({
  at: z.number(),
  agentId: z.string(),
  requesterUserId: z.string().optional(),
  site: z.string(),
  ok: z.boolean(),
});

export type WebMachineVisit = z.infer<typeof webMachineVisitSchema>;

const visitsKey = (workspaceId: string) =>
  `chief:web-machine-visits:${workspaceId}`;
const visitsKept = 200;

function readVisits(workspaceId: string): WebMachineVisit[] {
  try {
    const stored = webMachineVisitSchema
      .array()
      .safeParse(
        JSON.parse(window.localStorage.getItem(visitsKey(workspaceId)) ?? "[]"),
      );
    return stored.success ? stored.data : [];
  } catch {
    return [];
  }
}

function recordVisit(workspaceId: string, visit: WebMachineVisit) {
  try {
    window.localStorage.setItem(
      visitsKey(workspaceId),
      JSON.stringify([visit, ...readVisits(workspaceId)].slice(0, visitsKept)),
    );
  } catch {
    // The log is a courtesy; lending carries on without it.
  }
  window.dispatchEvent(new Event(changed));
}

export function useWebMachineVisits(workspaceId: string | undefined) {
  const stored = useSyncExternalStore(
    (notify) => {
      window.addEventListener(changed, notify);
      return () => window.removeEventListener(changed, notify);
    },
    () =>
      workspaceId
        ? (window.localStorage.getItem(visitsKey(workspaceId)) ?? "")
        : "",
  );
  return useMemo(
    () => (stored && workspaceId ? readVisits(workspaceId) : []),
    [stored, workspaceId],
  );
}

export function clearWebMachineVisits(workspaceId: string) {
  try {
    window.localStorage.removeItem(visitsKey(workspaceId));
  } catch {
    // Nothing to clear.
  }
  window.dispatchEvent(new Event(changed));
}

/** Keeps the lending connection open while it's switched on. */
export function useWebMachineHost(
  client: RelayClient | null,
  workspaceId: string | undefined,
) {
  const policy = useWebMachinePolicy(workspaceId);
  // A changed policy reconnects, so the relay always holds the current one.
  const policyKey = policy ? JSON.stringify(policy) : "";
  useEffect(() => {
    if (!client || !workspaceId || !policyKey || !isTauri()) return;
    let machine: Awaited<ReturnType<RelayClient["serveWebMachine"]>> | null =
      null;
    let stopped = false;
    void client
      .serveWebMachine({
        policy: webMachinePolicySchema.parse(JSON.parse(policyKey)),
        fetch: async ({ url, agentId, requesterUserId }) => {
          const visit = {
            at: Date.now(),
            agentId,
            ...(requesterUserId ? { requesterUserId } : undefined),
            site: new URL(url).hostname.replace(/^www\./u, ""),
          };
          try {
            const page = await invoke<{
              status: number;
              url: string;
              contentType: string;
              body: string;
            }>("machine_web_fetch", { url });
            recordVisit(workspaceId, { ...visit, ok: page.status < 400 });
            return page;
          } catch (error) {
            recordVisit(workspaceId, { ...visit, ok: false });
            throw error;
          }
        },
        onError: (error) => console.warn("[web-machine]", error.message),
      })
      .then(
        (opened) => {
          if (stopped) opened.close();
          else machine = opened;
        },
        (error: Error) => console.warn("[web-machine]", error.message),
      );
    return () => {
      stopped = true;
      machine?.close();
    };
  }, [client, policyKey, workspaceId]);
}
