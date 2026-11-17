# Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
completely, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the
guide does not cover, search through the source code in `node_modules/effect/src`.

# No polling

Chief is event-driven. An idle app with idle agents makes zero relay requests.

- Never poll the relay on a timer for state that can change. When the relay
  changes something, it pushes a signal over the socket the client already
  holds (see `workspace.presence` and `workspace.agents.changed`).
- Signals carry no data a member could not already read. The client re-reads
  through its normal authorized request, so access checks stay in one place.
- Read once on open, again on each signal, and once after a socket reconnects,
  because signals sent while it was down are lost.
- The relay retries its own deliveries (alarms), so clients never poll to
  cover a lost push. Dead sockets are found by missed pongs, which cost the
  relay nothing, and every reopen catches up.
- Local timers that only change what's on screen, like expiry countdowns, are
  fine. Timers that make network requests are not.
