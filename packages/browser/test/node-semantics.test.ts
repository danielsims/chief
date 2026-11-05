import assert from "node:assert/strict";
import test from "node:test";

import type { BrowserBoundaryValue } from "../src/node.js";
import {
  AgentBrowserSession,
  browserSnapshotLabel,
  browserSnapshotRef,
} from "../src/node.js";

void test("uses an explicit browser ref without rewriting it", () => {
  assert.equal(browserSnapshotRef(["@e58", "M4 Pro"], {}), "@e58");
});

void test("resolves concise labels to interactive snapshot option refs", () => {
  assert.equal(
    browserSnapshotRef(["M4 Pro chip"], {
      e55: {
        name: "Chip. Choose from these powerful options.",
        role: "heading",
      },
      e58: {
        name: "M4 Pro chip All the advanced technologies of M4",
        role: "radio",
      },
      e59: { name: "M4 Pro chip", role: "LabelText" },
    }),
    "@e58",
  );
});

void test("normalizes a bare machine ref and exposes its accessible label", () => {
  const refs = {
    e95: { name: "M4 Pro chip", role: "radio" },
  };

  assert.equal(browserSnapshotRef(["e95"], refs), "@e95");
  assert.equal(browserSnapshotLabel(["e95"], refs), "M4 Pro chip");
});

void test("describes the resolved interactive control instead of a contextual heading", () => {
  const refs = {
    e61: { name: "Colour. Pick your favourite.", role: "heading" },
    e150: { name: "Space Black", role: "radio" },
  };

  assert.equal(
    browserSnapshotLabel(["Colour. Pick your favourite.", "Space Black"], refs),
    "Space Black",
  );
});

void test("readable snapshots include page text without changing the default control snapshot", async () => {
  const session = new AgentBrowserSession({
    sessionId: "readable-snapshot-test",
    downloadPath: "/tmp/chief-browser-snapshot-test",
  });
  const commands: string[][] = [];
  session.command = (args): Promise<BrowserBoundaryValue> => {
    commands.push(args);
    if (args[0] === "snapshot")
      return Promise.resolve({
        snapshot: "- paragraph: Article text\n- link More [ref=e1]",
        refs: { e1: { name: "More", role: "link" } },
      });
    if (args[1] === "text")
      return Promise.resolve({ text: "Readable article paragraph" });
    if (args[1] === "url")
      return Promise.resolve({ url: "https://example.com/article" });
    return Promise.resolve({ title: "Article" });
  };
  const readable = await session.snapshot({ includeText: true });
  assert.match(readable.snapshot, /Readable article paragraph/);
  assert.ok(commands.some((args) => args.join(" ") === "get text body"));
  assert.deepEqual(commands[0], ["wait", "body"]);
  assert.deepEqual(commands[1], ["get", "text", "body"]);
  assert.deepEqual(commands[2], ["snapshot", "--interactive", "--compact"]);
  commands.length = 0;
  await session.snapshot();
  assert.deepEqual(commands[0], ["snapshot", "--interactive", "--compact"]);
});
