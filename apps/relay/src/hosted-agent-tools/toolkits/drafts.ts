import { draftCardPayloadSchema } from "@chief/relay-contracts";

import { defineHostedAgentTool } from "../tool";
import { postHostedCard } from "./cards";

export const hostedDraftTools = [
  defineHostedAgentTool(
    "drafts.show",
    async (context, input) => {
      const draft = draftCardPayloadSchema
        .pick({ format: true, to: true, subject: true, body: true })
        .parse(input);
      await postHostedCard(
        context,
        input,
        "draft",
        `${draft.subject ?? ""}:${draft.body.slice(0, 200)}`,
        draft,
      );
      return {
        shown: true,
        card: "The person can edit, copy or open this draft on a card in this conversation, so reply with one line rather than repeating it.",
      };
    },
    { effect: "idempotent" },
  ),
];
