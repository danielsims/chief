export function publicRelayErrorMessage(error: unknown) {
  if (
    error instanceof Error &&
    error.message.includes("Identifiers may only contain")
  ) {
    return "Chief couldn't route this conversation through the relay. Reopen the channel and try again.";
  }
  return error instanceof Error ? error.message : String(error);
}
