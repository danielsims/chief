import type { BrowserRunRecord } from "@chief/agent-runtime/types";

export interface BrowserRunAnchorCandidate {
  id: string;
  role: string;
  threadRootId: string | null;
  isBrowserOpen: boolean;
  createdAt?: number;
}

/**
 * Give every durable browser run its own immutable transcript anchor.
 *
 * A persisted anchor wins only while it remains inside the user turn that
 * opened the run. Older transcripts can contain missing, duplicate, or stale
 * anchors, so unresolved runs fall back to the closest preceding assistant
 * message after that turn's user message. This prevents a live browser from
 * jumping into an earlier exchange while its opening line is still streaming.
 */
export function resolveBrowserRunAnchors(
  runs: readonly BrowserRunRecord[],
  candidates: readonly BrowserRunAnchorCandidate[],
  liveAnchors: Readonly<Record<string, string | null>> = {},
): ReadonlyMap<string, string> {
  const candidatesById = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const anchors = new Map<string, string>();
  const used = new Set<string>();
  const orderedRuns = [...runs].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  const turnBoundaries = new Map<string, BrowserRunAnchorCandidate>();
  for (const run of orderedRuns) {
    const threadRootId = run.threadRootId ?? null;
    let boundary: BrowserRunAnchorCandidate | undefined;
    for (const candidate of candidates) {
      if (
        candidate.role !== "user" ||
        candidate.threadRootId !== threadRootId ||
        candidate.createdAt === undefined ||
        candidate.createdAt > run.createdAt
      ) {
        continue;
      }
      if (
        !boundary ||
        (boundary.createdAt ?? Number.NEGATIVE_INFINITY) <= candidate.createdAt
      ) {
        boundary = candidate;
      }
    }
    if (boundary) turnBoundaries.set(run.id, boundary);
  }
  const belongsToOpeningTurn = (
    run: BrowserRunRecord,
    candidate: BrowserRunAnchorCandidate,
  ) => {
    const boundary = turnBoundaries.get(run.id);
    return (
      !boundary ||
      (candidate.createdAt !== undefined &&
        candidate.createdAt >= (boundary.createdAt ?? 0))
    );
  };

  for (const run of orderedRuns) {
    const durable = run.anchorMessageId ?? liveAnchors[run.id] ?? undefined;
    const candidate = durable ? candidatesById.get(durable) : undefined;
    if (
      !durable ||
      !candidate ||
      !belongsToOpeningTurn(run, candidate) ||
      used.has(durable)
    ) {
      continue;
    }
    anchors.set(run.id, durable);
    used.add(durable);
  }

  const nearestPrecedingCandidate = (
    run: BrowserRunRecord,
    browserOpenOnly: boolean,
  ) => {
    const threadRootId = run.threadRootId ?? null;
    let match: BrowserRunAnchorCandidate | undefined;
    for (const candidate of candidates) {
      if (
        candidate.role !== "assistant" ||
        candidate.threadRootId !== threadRootId ||
        !belongsToOpeningTurn(run, candidate) ||
        used.has(candidate.id) ||
        (browserOpenOnly && !candidate.isBrowserOpen) ||
        candidate.createdAt === undefined ||
        candidate.createdAt > run.createdAt
      ) {
        continue;
      }
      if (
        !match ||
        (match.createdAt ?? Number.NEGATIVE_INFINITY) <= candidate.createdAt
      ) {
        match = candidate;
      }
    }
    return match;
  };

  for (const browserOpenOnly of [true, false]) {
    for (const run of orderedRuns) {
      if (anchors.has(run.id)) continue;
      const owner = nearestPrecedingCandidate(run, browserOpenOnly);
      if (!owner) continue;
      anchors.set(run.id, owner.id);
      used.add(owner.id);
    }
  }

  for (const run of orderedRuns) {
    if (anchors.has(run.id) || run.status !== "active") continue;
    const threadRootId = run.threadRootId ?? null;
    const boundary = turnBoundaries.get(run.id);
    const boundaryIndex = boundary
      ? candidates.findIndex((candidate) => candidate.id === boundary.id)
      : -1;
    let fallback: BrowserRunAnchorCandidate | undefined;
    for (let index = candidates.length - 1; index > boundaryIndex; index -= 1) {
      const candidate = candidates[index];
      if (
        candidate?.role === "assistant" &&
        candidate.threadRootId === threadRootId &&
        !used.has(candidate.id)
      ) {
        fallback = candidate;
        break;
      }
    }
    if (!fallback) continue;
    anchors.set(run.id, fallback.id);
    used.add(fallback.id);
  }

  return anchors;
}
