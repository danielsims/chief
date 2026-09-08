import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repository = process.cwd();
const hookArguments = JSON.parse(readFileSync("package.json", "utf8"))
  .scripts["check:staged"].split(" ")
  .slice(1);
const hook = readFileSync("tooling/scripts/format-staged.mjs", "utf8");
const config = readFileSync("lint-staged.config.mjs", "utf8");
const lintStaged = resolve("node_modules/lint-staged/bin/lint-staged.js");

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "chief-commit-hook-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  const write = (name, content) =>
    writeFileSync(join(directory, name), content);
  mkdirSync(join(directory, "tooling/scripts"), { recursive: true });
  mkdirSync(join(directory, "node_modules/.bin"), { recursive: true });
  write("tooling/scripts/format-staged.mjs", hook);
  write("lint-staged.config.mjs", config);
  write("package.json", '{"private":true}');
  write(".gitignore", "node_modules/\n");
  // A deterministic formatter makes index isolation independent of style rules.
  write(
    "node_modules/.bin/pnpm",
    `#!${process.execPath}
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const command = process.argv[2];
if (process.env.FAIL_CHECK === command) { console.error('requested failure: ' + command); process.exit(1); }
if (command === 'format:fix') {
  for (const file of execFileSync('git', ['ls-files', '-z'], {encoding:'utf8'}).split('\\0').filter(f => f.endsWith('.txt'))) {
    if (fs.existsSync(file)) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('unformatted', 'formatted'));
  }
  if (process.env.FAIL_CHECK === 'after-format') { console.error('requested failure: after-format'); process.exit(1); }
}
`,
  );
  execFileSync("chmod", ["+x", join(directory, "node_modules/.bin/pnpm")]);
  git("init", "--quiet");
  git("config", "user.name", "Hook Test");
  git("config", "user.email", "hook@example.test");
  git("config", "core.hooksPath", "/dev/null");
  write("partial.txt", "base\n" + "unchanged\n".repeat(20) + "original\n");
  write("untouched.txt", "unformatted\n");
  write("unfinished.txt", "original\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "Create fixture.");
  write(
    "partial.txt",
    "unformatted staged\n" + "unchanged\n".repeat(20) + "original\n",
  );
  git("add", "partial.txt");
  write(
    "partial.txt",
    "unformatted staged\n" + "unchanged\n".repeat(20) + "local-only\n",
  );
  write("unfinished.txt", "local-only\n");
  write("untracked.txt", "local-only\n");
  const run = (failure = "") =>
    execFileSync(process.execPath, [lintStaged, ...hookArguments], {
      cwd: directory,
      env: {
        ...process.env,
        FAIL_CHECK: failure,
      },
      stdio: "pipe",
    });
  return { git, run, directory };
}

test("formats the commit and other tracked files without including unfinished work", (t) => {
  const { git, run, directory } = fixture(t);
  run();
  assert.match(git("show", ":partial.txt"), /^formatted staged/);
  assert.doesNotMatch(git("show", ":partial.txt"), /local-only/);
  assert.equal(git("show", ":untouched.txt"), "formatted\n");
  assert.equal(git("show", ":unfinished.txt"), "original\n");
  assert.match(
    readFileSync(join(directory, "partial.txt"), "utf8"),
    /local-only/,
  );
  assert.equal(
    readFileSync(join(directory, "unfinished.txt"), "utf8"),
    "local-only\n",
  );
  assert.equal(
    readFileSync(join(directory, "untracked.txt"), "utf8"),
    "local-only\n",
  );
  assert.equal(git("ls-files", "untracked.txt"), "");
});

for (const failure of ["lint", "typecheck", "after-format"]) {
  test(`restores the index and local edits when ${failure} fails`, (t) => {
    const { git, run, directory } = fixture(t);
    const index = git("diff", "--cached");
    const local = git("diff");
    assert.throws(
      () => run(failure),
      (error) => String(error.stderr).includes(`requested failure: ${failure}`),
    );
    assert.equal(git("diff", "--cached"), index);
    assert.equal(git("diff"), local);
    assert.equal(
      readFileSync(join(directory, "untracked.txt"), "utf8"),
      "local-only\n",
    );
  });
}

test("refuses to stage pre-existing unstaged changes when invoked without isolation", (t) => {
  const { git, directory } = fixture(t);
  const index = git("diff", "--cached");
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [join(repository, "tooling/scripts/format-staged.mjs")],
      { cwd: directory, stdio: "pipe" },
    ),
  );
  assert.equal(git("diff", "--cached"), index);
});

test("runs checks for a commit containing only deletions", (t) => {
  const { git, run } = fixture(t);
  git("reset", "--quiet", "--", "partial.txt");
  git("rm", "untouched.txt");
  assert.throws(
    () => run("lint"),
    (error) => String(error.stderr).includes("requested failure: lint"),
  );
  run();
  assert.equal(git("diff", "--cached", "--name-status"), "D\tuntouched.txt\n");
});
