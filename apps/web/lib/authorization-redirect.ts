export function safeAuthorizationRedirect(value: string, webOrigin: string) {
  try {
    const destination = new URL(value);
    if (destination.username || destination.password || destination.hash)
      return null;
    if (
      destination.protocol === "http:" &&
      destination.hostname === "127.0.0.1" &&
      destination.port !== "0" &&
      destination.pathname === "/auth/desktop"
    ) {
      return destination.toString();
    }
    if (
      destination.origin === webOrigin &&
      (destination.protocol === "https:" ||
        (destination.protocol === "http:" &&
          (destination.hostname === "localhost" ||
            destination.hostname === "127.0.0.1")))
    ) {
      return destination.toString();
    }
    if (
      destination.protocol === "chief-desktop:" &&
      destination.host === "" &&
      destination.pathname === "/auth"
    ) {
      return destination.toString();
    }
    if (
      destination.protocol === "chief-mobile:" &&
      destination.hostname === "auth" &&
      (destination.pathname === "" || destination.pathname === "/")
    ) {
      return destination.toString();
    }
  } catch {
    // Better Auth owns error reporting; an invalid redirect is never followed.
  }
  return null;
}
