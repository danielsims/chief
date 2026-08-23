import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
} from "node:fs";
import { join } from "node:path";

const machOMagic = new Set([
  "cafebabe",
  "cafebabf",
  "bebafeca",
  "bfbafeca",
  "cefaedfe",
  "cffaedfe",
  "feedface",
  "feedfacf",
]);

function regularFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && lstatSync(path).isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function isMachO(path) {
  const descriptor = openSync(path, "r");
  try {
    const magic = Buffer.allocUnsafe(4);
    return readSync(descriptor, magic, 0, magic.length, 0) === magic.length
      ? machOMagic.has(magic.toString("hex"))
      : false;
  } finally {
    closeSync(descriptor);
  }
}

export function signDesktopRuntime(root, identity, entitlements) {
  if (process.platform !== "darwin" || !identity) return;
  const nativeFiles = regularFiles(root)
    .filter(isMachO)
    .map((path) => ({
      description: execFileSync("file", ["-b", path], {
        encoding: "utf8",
      }).trim(),
      path,
    }));

  for (const { description, path } of nativeFiles) {
    if (description.includes("executable")) chmodSync(path, 0o755);
    const args = ["--force", "--sign", identity];
    if (identity !== "-") args.push("--options", "runtime", "--timestamp");
    if (description.includes("executable") && existsSync(entitlements)) {
      args.push("--entitlements", entitlements);
    }
    args.push(path);
    execFileSync("codesign", args, { stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--strict", path], {
      stdio: "inherit",
    });
  }
  console.log(`Signed ${nativeFiles.length} native runtime payloads.`);
}
