import type { KeyboardEvent } from "react";

import type { ComposerEdit } from "./composer-editing";
import { removeAgentMentionBeforeCaret } from "./agent-mention-parser";

export function mentionBackspaceEdit(
  event: KeyboardEvent<HTMLTextAreaElement>,
  value: string,
): ComposerEdit | undefined {
  if (
    event.key !== "Backspace" ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return undefined;
  return removeAgentMentionBeforeCaret(
    value,
    event.currentTarget.selectionStart,
    event.currentTarget.selectionEnd,
  );
}
