import type { BoardItemSave, BoardLane } from "@chief/relay-contracts";
import {
  boardItemDeleteResultSchema,
  boardItemSchema,
  boardSchema,
} from "@chief/relay-contracts";

import type { RelayClientOptions } from "./relay-client-options";
import { RelayClientBase } from "./relay-client-base";

/** The workspace board: tracked work, by the lane it is in. */
export class RelayBoardClient extends RelayClientBase {
  constructor(options: RelayClientOptions) {
    super(options);
  }

  get() {
    return this.fetchJson(this.workspaceUrl("board"), boardSchema);
  }

  save(input: BoardItemSave) {
    return this.fetchJson(
      this.workspaceUrl("board/items"),
      boardItemSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  remove(itemId: string) {
    return this.fetchJson(
      this.workspaceUrl(`board/items/${encodeURIComponent(itemId)}`),
      boardItemDeleteResultSchema,
      true,
      { method: "DELETE" },
    );
  }

  saveLanes(lanes: readonly BoardLane[]) {
    return this.fetchJson(this.workspaceUrl("board/lanes"), boardSchema, true, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lanes }),
    });
  }
}
