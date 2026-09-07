import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { FileHandle } from "node:fs/promises";

const DARWIN_O_NOFOLLOW_ANY = 0x20000000;

/** Open the checked path without following symlinks, including raced parent links. */
export async function openWorkspaceFile(
  rootPath: string,
  requestedPath: string,
): Promise<FileHandle> {
  const root = await realpath(rootPath);
  const path = await realpath(resolve(root, requestedPath));
  const scoped = relative(root, path);
  if (
    !scoped ||
    scoped === ".." ||
    scoped.startsWith(`..${sep}`) ||
    resolve(root, scoped) !== path
  ) {
    throw new Error("Published files must stay inside the agent workspace.");
  }
  return openWithoutSymlinks(path);
}

/** Kernel-enforced open used after containment validation; exported for race regression tests. */
export async function openWithoutSymlinks(path: string): Promise<FileHandle> {
  if (process.platform === "darwin") {
    // Node does not export this macOS flag; it atomically rejects links in any component.
    return open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | DARWIN_O_NOFOLLOW_ANY,
    );
  }
  if (process.platform !== "linux") {
    throw new Error(
      "Secure artifact publishing is not supported on this platform.",
    );
  }
  // Linux /proc/self/fd anchors each lookup to an open directory, not a mutable path.
  let directory = await open("/", constants.O_RDONLY | constants.O_DIRECTORY);
  const parts = path.split("/").filter(Boolean);
  try {
    for (const part of parts.slice(0, -1)) {
      const next = await open(
        `/proc/self/fd/${directory.fd}/${part}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      await directory.close();
      directory = next;
    }
    return await open(
      `/proc/self/fd/${directory.fd}/${parts.at(-1)}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } finally {
    await directory.close();
  }
}
