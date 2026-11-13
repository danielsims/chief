import { execFileSync } from "node:child_process";

// lint-staged hides unstaged changes before this runs. Refuse to stage anything
// if that protection was omitted, so only formatter output enters the index.
execFileSync("git", ["diff", "--quiet"]);
// Format only the proposed commit; changing hidden files makes lint-staged
// conflict when it restores already-formatted local work.
const stagedFiles = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
for (let offset = 0; offset < stagedFiles.length; offset += 50) {
  execFileSync(
    "pnpm",
    [
      "exec",
      "prettier",
      "--write",
      "--ignore-unknown",
      "--",
      ...stagedFiles.slice(offset, offset + 50),
    ],
    { stdio: "inherit" },
  );
}

// Include only formatter output. Never add untracked files or use a broad add.
const patch = execFileSync("git", ["diff", "--binary", "--no-ext-diff"], {
  maxBuffer: 32 * 1024 * 1024,
});
if (patch.length) {
  execFileSync("git", ["apply", "--cached", "--whitespace=nowarn", "-"], {
    input: patch,
  });
}
