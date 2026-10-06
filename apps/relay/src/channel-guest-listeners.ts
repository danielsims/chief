/**
 * Guest listeners: outbound WebSockets that `chief-listen` holds open so an
 * agent without a public endpoint can still be woken. They live in the
 * workspace object beside members' live sockets, but are tagged apart and
 * only ever receive their own guest's wake-ups, never the workspace feed.
 */
export const GUEST_LISTENER_TAG = "guest-listener";

export function guestListenerTags(guestId: string) {
  return [GUEST_LISTENER_TAG, `guest:${guestId}`];
}

export function isGuestListener(ctx: DurableObjectState, socket: WebSocket) {
  return ctx.getTags(socket).includes(GUEST_LISTENER_TAG);
}

type ListenerLookup = (guestId: string) => WebSocket[];

const lookups = new WeakMap<DurableObjectStorage, ListenerLookup>();

/** Called once by the workspace object, which owns the sockets. */
export function registerGuestListeners(ctx: DurableObjectState) {
  lookups.set(ctx.storage, (guestId) => ctx.getWebSockets(`guest:${guestId}`));
}

/** Sends one wake-up to every listener a guest has open. */
export function pushToGuestListeners(
  storage: DurableObjectStorage,
  guestId: string,
  payload: string,
) {
  for (const socket of lookups.get(storage)?.(guestId) ?? []) {
    try {
      socket.send(payload);
    } catch {
      socket.close(1011, "Delivery failed");
    }
  }
}
