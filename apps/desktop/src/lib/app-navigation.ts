export const CHIEF_DEEP_LINK_SCHEME = "chief-desktop";

export const CHIEF_VIEW_ROUTES = {
  overview: "/",
  inbox: "/inbox",
  analytics: "/analytics",
  artifacts: "/artifacts",
  campaigns: "/campaigns",
  schedule: "/schedule",
  prospects: "/prospects",
  trending: "/trending",
  agents: "/agents",
  plugins: "/plugins",
  files: "/files",
  profileSettings: "/settings/profile",
  workspaceSettings: "/settings/workspace",
  missionSettings: "/settings/missions",
  notificationSettings: "/settings/notifications",
} as const;

export type ChiefView = keyof typeof CHIEF_VIEW_ROUTES;

export interface MessageNavigationTarget {
  channelId: string;
  channelSlug?: string | null;
  directAgentId?: string | null;
  messageId: string;
  threadRootId?: string | null;
}

export type ChiefNavigationDestination =
  | { kind: "view"; view: ChiefView }
  | {
      kind: "conversation";
      channelId: string;
      channelSlug?: string | null;
      directAgentId?: string | null;
      messageId?: string | null;
      threadRootId?: string | null;
    };

type ChiefNavigationListener = (
  destination: ChiefNavigationDestination,
) => void;

const listeners = new Set<ChiefNavigationListener>();
let pendingDestination: ChiefNavigationDestination | null = null;

function nonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : null;
}

function viewForRoute(pathname: string) {
  return (Object.entries(CHIEF_VIEW_ROUTES) as [ChiefView, string][]).find(
    ([, route]) => route === pathname,
  )?.[0];
}

function conversationFromParams(params: URLSearchParams) {
  const channelId = nonEmpty(params.get("channelId") ?? params.get("channel"));
  const directAgentId = nonEmpty(params.get("dm"));
  if (!channelId && !directAgentId) return null;
  return {
    kind: "conversation",
    channelId: channelId ?? `direct:${directAgentId}`,
    ...(nonEmpty(params.get("channelSlug"))
      ? { channelSlug: nonEmpty(params.get("channelSlug")) }
      : {}),
    ...(directAgentId ? { directAgentId } : {}),
    ...(nonEmpty(params.get("threadRootId") ?? params.get("thread"))
      ? {
          threadRootId: nonEmpty(
            params.get("threadRootId") ?? params.get("thread"),
          ),
        }
      : {}),
    ...(nonEmpty(params.get("messageId") ?? params.get("message"))
      ? {
          messageId: nonEmpty(params.get("messageId") ?? params.get("message")),
        }
      : {}),
  } satisfies ChiefNavigationDestination;
}

export function messageDestination(
  target: MessageNavigationTarget,
): ChiefNavigationDestination {
  return { kind: "conversation", ...target };
}

export function routeForChiefDestination(
  destination: ChiefNavigationDestination,
) {
  if (destination.kind === "view") {
    return CHIEF_VIEW_ROUTES[destination.view];
  }
  const params = new URLSearchParams();
  if (destination.directAgentId) params.set("dm", destination.directAgentId);
  else params.set("channel", destination.channelSlug ?? destination.channelId);
  if (destination.threadRootId) params.set("thread", destination.threadRootId);
  if (destination.messageId) params.set("message", destination.messageId);
  return `/conversations?${params.toString()}`;
}

export function chiefDeepLinkUrl(destination: ChiefNavigationDestination) {
  const surface =
    destination.kind === "view" ? destination.view : "conversation";
  const url = new URL(`${CHIEF_DEEP_LINK_SCHEME}://navigate/${surface}`);
  if (destination.kind === "conversation") {
    url.searchParams.set("channelId", destination.channelId);
    if (destination.channelSlug)
      url.searchParams.set("channelSlug", destination.channelSlug);
    if (destination.directAgentId)
      url.searchParams.set("dm", destination.directAgentId);
    if (destination.threadRootId)
      url.searchParams.set("threadRootId", destination.threadRootId);
    if (destination.messageId)
      url.searchParams.set("messageId", destination.messageId);
  }
  return url.toString();
}

export function parseChiefDeepLink(
  value: string,
): ChiefNavigationDestination | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== `${CHIEF_DEEP_LINK_SCHEME}:`) return null;
  const parts = [url.hostname, ...url.pathname.split("/")].filter(Boolean);
  if (parts[0] === "message") {
    const destination = conversationFromParams(url.searchParams);
    return destination?.kind === "conversation" && destination.messageId
      ? destination
      : null;
  }
  if (parts[0] !== "navigate" || !parts[1]) return null;
  if (parts[1] === "conversation") {
    return conversationFromParams(url.searchParams);
  }
  const view = parts[1] as ChiefView;
  return view in CHIEF_VIEW_ROUTES ? { kind: "view", view } : null;
}

export function parseChiefNavigationHref(
  value: string,
): ChiefNavigationDestination | null {
  const deepLink = parseChiefDeepLink(value);
  if (deepLink) return deepLink;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(value, "https://chief.local");
  } catch {
    return null;
  }
  if (url.pathname === "/conversations") {
    return conversationFromParams(url.searchParams);
  }
  const view = viewForRoute(url.pathname);
  return view ? { kind: "view", view } : null;
}

/** Converts agent-authored Chief links to app routes before Markdown sanitizing. */
export function normalizeChiefNavigationLinks(markdown: string) {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(
            /\]\((chief-desktop:\/\/[^)\s]+)\)/g,
            (match, href: string) => {
              const destination = parseChiefDeepLink(href);
              return destination
                ? `](${routeForChiefDestination(destination)})`
                : match;
            },
          ),
    )
    .join("");
}

export function dispatchChiefNavigation(
  destination: ChiefNavigationDestination,
) {
  if (listeners.size === 0) {
    pendingDestination = destination;
    return;
  }
  pendingDestination = null;
  for (const listener of listeners) listener(destination);
}

export function listenForChiefNavigation(listener: ChiefNavigationListener) {
  listeners.add(listener);
  if (pendingDestination) {
    const destination = pendingDestination;
    pendingDestination = null;
    listener(destination);
  }
  return () => {
    listeners.delete(listener);
  };
}
