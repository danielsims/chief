import { draftCardPayloadSchema } from "@chief/relay-contracts";

import { postCellCard } from "../cards.js";
import { defineRelayCellTool } from "../tool.js";

export const relayCellDraftTools = [
  defineRelayCellTool(
    "drafts.show",
    "messages.send",
    async (context, input) => {
      const draft = draftCardPayloadSchema
        .pick({ format: true, to: true, subject: true, body: true })
        .parse(input);
      await postCellCard(context, "draft", draft);
      return {
        shown: true,
        card: "The person can edit, copy or open this draft on a card in this conversation, so reply with one line rather than repeating it.",
      };
    },
  ),
];
