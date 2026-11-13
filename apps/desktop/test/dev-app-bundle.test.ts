import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

void test("the Mac dev runner supplies the bundle identity required by native notifications", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "chief-dev-bundle-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = join(directory, "desktop");
  writeFileSync(executable, '#!/bin/sh\nprintf "%s\\n" "$0" "$1"\n');
  chmodSync(executable, 0o755);
  const signer = join(directory, "codesign");
  writeFileSync(
    signer,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$CHIEF_TEST_SIGNING_LOG"\n',
  );
  chmodSync(signer, 0o755);
  const signingLog = join(directory, "signing.log");
  const output = execFileSync(
    "bash",
    [resolve("src-tauri/scripts/dev-run.sh"), executable, "argument"],
    {
      encoding: "utf8",
      env: {
        PATH: `${directory}:/usr/bin:/bin`,
        CHIEF_DEV_SIGNING_IDENTITY: "test-identity",
        CHIEF_TEST_SIGNING_LOG: signingLog,
      },
    },
  );
  const bundle = join(directory, "Chief Dev.app");
  assert.equal(output, `${bundle}/Contents/MacOS/Chief Dev\nargument\n`);
  const plist = readFileSync(join(bundle, "Contents/Info.plist"), "utf8");
  assert.match(
    plist,
    /CFBundleIdentifier<\/key><string>sh\.heychief\.desktop\.dev/,
  );
  assert.match(plist, /CFBundleExecutable<\/key><string>Chief Dev/);
  assert.match(plist, /CFBundleURLSchemes<\/key><array><string>chief-desktop/);
  assert.ok(
    readFileSync(join(bundle, "Contents/Resources/dev-icon.icns")).length > 0,
  );
  assert.equal(
    readFileSync(signingLog, "utf8").trim().split("\n").at(-1),
    bundle,
  );
});
