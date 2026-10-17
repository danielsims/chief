import { describe, expect, it } from "vitest";

import { extractTarGz } from "../src/workspace-git-import";

function writeText(target: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function tarEntry(name: string, content: string) {
  const data = new TextEncoder().encode(content);
  const header = new Uint8Array(512);
  writeText(header, 0, name);
  writeText(header, 124, data.byteLength.toString(8).padStart(11, "0"));
  writeText(header, 156, "0");
  const padded = (512 - (data.byteLength % 512)) % 512;
  const entry = new Uint8Array(512 + data.byteLength + padded);
  entry.set(header, 0);
  entry.set(data, 512);
  return entry;
}

function concat(parts: Uint8Array[]) {
  const bytes = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

async function tarGzBlob(entries: { name: string; content: string }[]) {
  const tar = concat([
    ...entries.map((entry) => tarEntry(entry.name, entry.content)),
    new Uint8Array(1024),
  ]);
  const stream = new Blob([tar])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Blob([await new Response(stream).arrayBuffer()]);
}

describe("workspace git import", () => {
  it("extracts regular files and strips the tarball root", async () => {
    const blob = await tarGzBlob([
      { name: "acme-abc123/README.md", content: "# Acme\n" },
      { name: "acme-abc123/src/index.ts", content: "export {};\n" },
    ]);
    const files = await extractTarGz(blob);
    expect(files).toEqual([
      { path: "README.md", content: "# Acme\n" },
      { path: "src/index.ts", content: "export {};\n" },
    ]);
  });

  it("skips dependency and dotfile directories", async () => {
    const blob = await tarGzBlob([
      { name: "acme-abc123/README.md", content: "ok\n" },
      { name: "acme-abc123/node_modules/left-pad/index.js", content: "x\n" },
      { name: "acme-abc123/.git/config", content: "y\n" },
    ]);
    const files = await extractTarGz(blob);
    expect(files.map((file) => file.path)).toEqual(["README.md"]);
  });
});
