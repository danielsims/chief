export function debugSendMessage(input: {
  chatId: string;
  threadRootId?: string;
  mentions?: string[];
  shared: boolean;
  resolvedThreadRootId?: string;
}) {
  if (process.env.CHIEF_DEBUG_SESSION_FORCE !== "1") return;
  console.error(
    `[sendMessage] chatId=${input.chatId} threadRootId=${input.threadRootId ?? "none"} mentions=${JSON.stringify(input.mentions ?? [])} shared=${input.shared ? "y" : "n"} resolvedThreadRoot=${input.resolvedThreadRootId ?? "none"}`,
  );
}
