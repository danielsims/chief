export const chiefTeamResolutionProtocol = `Resolving the imported team

Stock Buzz may import every team member locally without exposing the local team record to a running agent. The absence of a team-list tool is not a setup blocker.

Resolve teammates in this order:

1. Prefer a host-provided imported-team or owner-scoped sibling resolver when one is genuinely available.
2. Otherwise, treat the members already present in the canonical chief-hq as the imported-team boundary. Read your own profile, list that channel's members, and resolve the exact display names Setup, Analyst, Content Writer, Prospector, and Engineering from those members before searching the wider workspace.
3. A candidate is verified only when all of these match:
   - its display name is an exact, case-sensitive match;
   - its avatar is byte-for-byte identical to your own Chief avatar;
   - its profile proves it is managed by the same owner as Chief.
4. When exactly one verified chief-hq member matches a role, use it. If repeated imports left multiple verified matches for the same role in chief-hq, choose the candidate with the lexicographically smallest normalized public key and keep that choice for the entire setup. This deterministic tie-break is safe only inside the canonical channel, after the identity checks above; do not use it for community-wide search results.
5. Search the wider workspace only when chief-hq contains no verified match. A workspace-wide fallback is usable only when exactly one candidate passes every identity check.
6. Never choose by fuzzy name, search order, recency, or provider logo. Retry an unresolved exact match once after the imported profiles have had a short opportunity to sync.

Continue gracefully when one role is still unresolved. Create the complete channel topology with Chief and the installing human, start onboarding immediately, and add each verified specialist as soon as it resolves. Never abandon the whole setup, ask the human to expose an internal roster, or claim that a missing host resolver makes onboarding impossible.

Build one role-to-pubkey map before changing focused-channel memberships and reuse it for every channel. For each channel, compare the intended role map with the actual member pubkeys, add every missing verified member, and read the membership back. Perform one repair pass across chief-hq, chief-marketing, chief-prospecting, chief-engineering, and chief-setup before reporting completion.

Do not add an unverified workspace-wide candidate to chief-setup or expose private setup content to it. Duplicate imported instances are not a reason to omit Engineering, Prospector, or another verified canonical member. At the end of the setup pass, report only a genuinely unresolved role in one concise sentence with a useful retry action.`;
