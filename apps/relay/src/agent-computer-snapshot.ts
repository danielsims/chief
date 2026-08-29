import type { AgentComputer } from "@chief/agent-computer";

import { HttpError } from "./http";

const MAX_PORTABLE_COMPUTER_BYTES = 8 * 1_024 * 1_024;

export async function exportComputerFiles(computer: AgentComputer) {
  const files: { path: string; contentBase64: string }[] = [];
  let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await computer.list(directory);
    for (const entry of entries) {
      if (entry.kind === "directory") {
        await visit(entry.path);
        continue;
      }
      if (entry.kind !== "file") continue;
      const content = await computer.readBytes(entry.path);
      bytes += content.byteLength;
      if (bytes > MAX_PORTABLE_COMPUTER_BYTES || files.length >= 1_000) {
        throw snapshotTooLarge();
      }
      files.push({ path: entry.path, contentBase64: bytesToBase64(content) });
    }
  };
  try {
    await visit("/workspace");
  } catch (error) {
    if (files.length > 0 || error instanceof HttpError) throw error;
  }
  return files;
}

export async function importComputerFiles(
  computer: AgentComputer,
  files: readonly { path: string; contentBase64: string }[],
) {
  const decoded = files.map((file) => ({
    path: file.path,
    content: base64ToBytes(file.contentBase64),
  }));
  const total = decoded.reduce((sum, file) => sum + file.content.byteLength, 0);
  if (total > MAX_PORTABLE_COMPUTER_BYTES) throw snapshotTooLarge();
  await computer.remove("/workspace", true).catch(() => undefined);
  for (const file of decoded) {
    await computer.writeBytes(file.path, file.content);
  }
}

function snapshotTooLarge() {
  return new HttpError(
    413,
    "cell_snapshot_too_large",
    "The agent computer exceeds the portable snapshot limit.",
  );
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
