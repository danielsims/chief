import assert from "node:assert/strict";
import test from "node:test";

import { parsePageDocument } from "@chief/relay-contracts";

import { pageBoard } from "../src/components/pages/page-board";
import { rendererSpec } from "../src/components/pages/page-renderer-spec";

const database = "07d9ae5d-53f6-52d9-ae0b-73d80ccc590d";
const board = {
  sources: { records: { database } },
  spec: {
    root: "board",
    elements: {
      board: { type: "Board", props: { source: "records" }, children: [] },
    },
  },
};

void test("board artifacts reference existing records and reject unknown sources", () => {
  assert.deepEqual(pageBoard(JSON.stringify(board)), { database });
  assert.equal(
    parsePageDocument(JSON.stringify({ ...board, sources: {} })).success,
    false,
  );
  assert.equal(pageBoard("invalid"), undefined);
  assert.equal(
    pageBoard(
      JSON.stringify({
        ...board,
        spec: {
          ...board.spec,
          elements: { board: { ...board.spec.elements.board, visible: false } },
        },
      }),
    ),
    undefined,
  );
});

void test("pages without visibility rules remain visible; explicit rules are preserved", () => {
  const parsed = parsePageDocument(
    JSON.stringify({
      spec: {
        root: "text",
        elements: {
          text: {
            type: "Text",
            props: { text: "Visible content" },
            children: [],
          },
          hidden: {
            type: "Text",
            props: { text: "Hidden content" },
            children: [],
            visible: false,
          },
        },
      },
    }),
  );
  assert.ok(parsed.success);
  const spec = rendererSpec(parsed.page.spec);
  assert.equal(spec.elements.text?.visible, undefined);
  assert.equal(spec.elements.hidden?.visible, false);
});
