import { useEffect, useState } from "react";

import type { RelayClient } from "@chief/relay-client";
import { USERNAME_MAX_LENGTH, usernameIssue } from "@chief/relay-contracts";

const CHECK_DELAY_MS = 350;
const SUGGESTION_COUNT = 3;
const SUGGESTION_ATTEMPTS = 8;

export type UsernameCheck =
  | { state: "idle" | "checking" | "available" }
  | { state: "taken"; message: string; suggestions: string[] };

/**
 * Asks the relay whether a username is free once typing pauses, and offers a
 * few free alternatives when it isn't. The relay's unique index still has the
 * final say when the profile is saved.
 */
export function useUsernameCheck(
  client: RelayClient | null,
  username: string,
): UsernameCheck {
  const [check, setCheck] = useState<{
    username: string;
    result: UsernameCheck;
  } | null>(null);
  const valid = usernameIssue(username).ok;
  useEffect(() => {
    if (!client || !valid) return;
    let stopped = false;
    // Read through a call: the answer can change while a request is out.
    const current = () => !stopped;
    const look = async () => {
      const result = await client.usernameAvailability(username);
      if (!current()) return;
      if (result.available || result.reason !== "taken") {
        setCheck({ username, result: { state: "available" } });
        return;
      }
      const suggestions = await freeAlternatives(client, username);
      if (current())
        setCheck({
          username,
          result: { state: "taken", message: result.message, suggestions },
        });
    };
    const timer = setTimeout(() => {
      look().catch(() => {
        // Unchecked is fine: saving still enforces uniqueness.
        if (current()) setCheck({ username, result: { state: "idle" } });
      });
    }, CHECK_DELAY_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [client, username, valid]);
  if (!client || !valid) return { state: "idle" };
  return check?.username === username ? check.result : { state: "checking" };
}

/** The username with a short number on the end, keeping only free ones. */
async function freeAlternatives(client: RelayClient, username: string) {
  const base = username.slice(0, USERNAME_MAX_LENGTH - 3);
  const tried = new Set<string>();
  const free: string[] = [];
  for (
    let attempt = 0;
    attempt < SUGGESTION_ATTEMPTS && free.length < SUGGESTION_COUNT;
    attempt += 1
  ) {
    const candidate = `${base}${10 + Math.floor(Math.random() * 990)}`;
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    const result = await client.usernameAvailability(candidate);
    if (result.available) free.push(result.username);
  }
  return free;
}
