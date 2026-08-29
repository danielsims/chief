/**
 * Better Auth cookies are scoped by hostname rather than origin. Encode the
 * full relay origin so two authorities on different localhost ports never
 * share browser authentication state.
 */
export function relayCookiePrefix(baseURL: string) {
  const origin = new URL(baseURL).origin;
  const namespace = Array.from(origin, (character) =>
    /[a-z\d]/iu.test(character)
      ? character.toLocaleLowerCase()
      : `_${character.codePointAt(0)?.toString(16) ?? "0"}_`,
  ).join("");
  return `chief_relay_${namespace}`;
}
