import { z } from "zod";

import type { OwnedAgentRequest } from "@chief/relay-contracts";

import { notifySystem } from "./notifications";
import { agentName } from "./owned-agent-presentation";

const remembered = new Map<string, Set<string>>();
const receiptSchema = z.array(z.string());

/** Persist receipts per relay/workspace so polling and remounts don't repeat alerts. */
export function unnotifiedAgentRequests(
  scope: string,
  requests: readonly OwnedAgentRequest[],
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  now = Date.now(),
) {
  const key = `chief.agent-join-notifications.v1:${scope}`;
  const seen = remembered.get(key) ?? new Set<string>();
  try {
    const stored = receiptSchema.safeParse(
      JSON.parse(storage?.getItem(key) ?? "[]"),
    );
    if (stored.success) for (const id of stored.data) seen.add(id);
  } catch {
    /* Keep in-memory receipts when browser storage is unavailable. */
  }
  const fresh = requests.filter((request) => {
    if (Date.parse(request.expiresAt) <= now || seen.has(request.id))
      return false;
    seen.add(request.id);
    return true;
  });
  const pending = new Set(requests.map((request) => request.id));
  const retained = new Set(
    [...seen].filter((id) => pending.has(id)).concat([...seen].slice(-100)),
  );
  remembered.set(key, retained);
  try {
    storage?.setItem(key, JSON.stringify([...retained]));
  } catch {
    /* Receipts remain in memory. */
  }
  return fresh;
}

export function notifyAgentJoinRequests(
  scope: string,
  requests: readonly OwnedAgentRequest[],
) {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    /* Storage may be disabled. */
  }
  for (const request of unnotifiedAgentRequests(scope, requests, storage)) {
    void notifySystem(
      `${agentName(request.provider, request.name)} wants to join`,
      `${request.handle} requested access. Review the request in Agents.`,
      { kind: "route", route: "/agents" },
    );
  }
}
