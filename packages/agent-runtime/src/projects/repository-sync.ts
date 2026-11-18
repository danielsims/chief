import { git } from "./repository-git.js";

/** How long a fetched repository counts as current. */
const FRESH_FOR_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

const lastSynced = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();

/**
 * Brings a clone Chief owns up to date with its remote before it is shown
 * or branched from: fetch, then fast-forward the checked-out branch when it
 * is clean and has nothing of its own. A person's attached repository is
 * never touched. Best effort: offline or without credentials, the snapshot
 * shows what is already on disk.
 */
export function syncOwnedClone(repositoryPath: string) {
  const pending = inFlight.get(repositoryPath);
  if (pending) return pending;
  if (Date.now() - (lastSynced.get(repositoryPath) ?? 0) < FRESH_FOR_MS)
    return Promise.resolve();
  const run = (async () => {
    try {
      await git(
        ["fetch", "--prune", "--quiet", "origin"],
        repositoryPath,
        FETCH_TIMEOUT_MS,
      );
      lastSynced.set(repositoryPath, Date.now());
      const status = await git(
        ["status", "--porcelain=v2", "--branch"],
        repositoryPath,
      );
      const upstream = /^# branch\.upstream (.+)$/m.exec(status)?.[1];
      const divergence = /^# branch\.ab \+(\d+) -(\d+)$/m.exec(status);
      const changed = status
        .split("\n")
        .some((line) => line && !line.startsWith("#"));
      if (
        upstream &&
        !changed &&
        divergence?.[1] === "0" &&
        Number(divergence[2]) > 0
      )
        await git(["merge", "--ff-only", "--quiet", upstream], repositoryPath);
    } catch {
      // Keep showing what's on disk.
    } finally {
      inFlight.delete(repositoryPath);
    }
  })();
  inFlight.set(repositoryPath, run);
  return run;
}
