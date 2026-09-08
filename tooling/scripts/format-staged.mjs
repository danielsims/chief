import { execFileSync } from "node:child_process";

// lint-staged hides unstaged changes before this runs. Refuse to stage anything
// if that protection was omitted, so only formatter output enters the index.
execFileSync("git", ["diff", "--quiet"]);
execFileSync("pnpm", ["format:fix"], { stdio: "inherit" });

// Workspace format tasks do not cover root config files and tooling scripts.
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

// Include formatting fixes in tracked files outside the original selection too.
// Never add untracked files or use a broad `git add` from this hook.
const patch = execFileSync("git", ["diff", "--binary", "--no-ext-diff"], {
  maxBuffer: 32 * 1024 * 1024,
});
if (patch.length) {
  execFileSync("git", ["apply", "--cached", "--whitespace=nowarn", "-"], {
    input: patch,
  });
}
