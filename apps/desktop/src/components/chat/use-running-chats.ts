import { useEffect, useState } from "react";

import { useRuntime } from "../../lib/runtime";

/** Tracks live runtime activity by chat so conversation presence stays reactive. */
export function useRunningChats(): Record<string, boolean> {
  const { client } = useRuntime();
  const [running, setRunning] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // A reaction or edit resends a message that is already here; only a new
    // message starts work.
    const seen = new Set<string>();
    const unsubscribe = client.subscribe((message) => {
      if (message.type === "message" && message.message.role === "user") {
        if (seen.has(message.message.id)) return;
        seen.add(message.message.id);
        setRunning((current) => ({
          ...current,
          [message.chatId]: true,
        }));
        return;
      }
      if (message.type !== "event") return;
      const event = message.event;
      const next =
        event.type === "stream" ||
        (event.type === "message" && event.role === "user") ||
        (event.type === "status" && event.status === "running")
          ? true
          : event.type === "result" ||
              event.type === "error" ||
              event.type === "exit" ||
              (event.type === "status" && event.status !== "running")
            ? false
            : undefined;
      if (next === undefined) return;
      setRunning((current) =>
        current[message.chatId] === next
          ? current
          : { ...current, [message.chatId]: next },
      );
    });
    return () => {
      unsubscribe();
    };
  }, [client]);

  return running;
}
