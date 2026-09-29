import assert from "node:assert/strict";
import test from "node:test";

import type {
  AppUpdateDependencies,
  DownloadableUpdate,
} from "../src/lib/app-update";
import { createAppUpdateController } from "../src/lib/app-update";

function fakeUpdate(
  version: string,
  overrides: Partial<DownloadableUpdate> = {},
): DownloadableUpdate & { downloads: number; installs: number } {
  const update = {
    version,
    downloads: 0,
    installs: 0,
    download: () => {
      update.downloads += 1;
      return Promise.resolve();
    },
    install: () => {
      update.installs += 1;
      return Promise.resolve();
    },
    ...overrides,
  };
  return update;
}

function dependencies(
  check: AppUpdateDependencies["check"],
): AppUpdateDependencies & { relaunches: number; warnings: string[] } {
  const result = {
    relaunches: 0,
    warnings: [] as string[],
    check,
    relaunch: () => {
      result.relaunches += 1;
      return Promise.resolve();
    },
    warn: (message: string) => {
      result.warnings.push(message);
    },
  };
  return result;
}

void test("a published release downloads in the background before it is shown", async () => {
  const update = fakeUpdate("0.1.3");
  const updates = createAppUpdateController(
    dependencies(() => Promise.resolve(update)),
  );
  const seen: string[] = [];
  updates.subscribe(() => seen.push(updates.getStatus().state));

  await updates.refresh();

  assert.equal(update.downloads, 1);
  assert.deepEqual(seen, ["downloading", "ready"]);
  assert.deepEqual(updates.getStatus(), { state: "ready", version: "0.1.3" });
});

void test("no release and failed checks stay quiet", async () => {
  const quiet = createAppUpdateController(
    dependencies(() => Promise.resolve(null)),
  );
  await quiet.refresh();
  assert.deepEqual(quiet.getStatus(), { state: "idle" });

  const offline = createAppUpdateController(
    dependencies(() => Promise.reject(new Error("offline"))),
  );
  await offline.refresh();
  assert.deepEqual(offline.getStatus(), { state: "idle" });

  const interrupted = createAppUpdateController(
    dependencies(() =>
      Promise.resolve(
        fakeUpdate("0.1.3", {
          download: () => Promise.reject(new Error("interrupted")),
        }),
      ),
    ),
  );
  await interrupted.refresh();
  assert.deepEqual(interrupted.getStatus(), { state: "idle" });
});

void test("a staged release is kept until restart and concurrent checks share one download", async () => {
  let checks = 0;
  const update = fakeUpdate("0.1.3");
  const updates = createAppUpdateController(
    dependencies(() => {
      checks += 1;
      return Promise.resolve(update);
    }),
  );

  await Promise.all([updates.refresh(), updates.refresh()]);
  await updates.refresh();

  assert.equal(checks, 1);
  assert.equal(update.downloads, 1);
});

void test("installing applies the staged release and restarts", async () => {
  const update = fakeUpdate("0.1.3");
  const deps = dependencies(() => Promise.resolve(update));
  const updates = createAppUpdateController(deps);

  await updates.install();
  assert.equal(update.installs, 0, "nothing installs before a download");

  await updates.refresh();
  await updates.install();

  assert.equal(update.installs, 1);
  assert.equal(deps.relaunches, 1);
  assert.deepEqual(updates.getStatus(), {
    state: "installing",
    version: "0.1.3",
  });
});

void test("a failed install can be retried with a fresh download", async () => {
  let attempts = 0;
  const updates = createAppUpdateController(
    dependencies(() =>
      Promise.resolve(
        fakeUpdate("0.1.3", {
          install: () => {
            attempts += 1;
            return attempts === 1
              ? Promise.reject(new Error("disk full"))
              : Promise.resolve();
          },
        }),
      ),
    ),
  );

  await updates.refresh();
  await updates.install();
  assert.deepEqual(updates.getStatus(), { state: "failed", version: "0.1.3" });

  await updates.install();
  assert.equal(attempts, 2);
  assert.deepEqual(updates.getStatus(), {
    state: "installing",
    version: "0.1.3",
  });
});
