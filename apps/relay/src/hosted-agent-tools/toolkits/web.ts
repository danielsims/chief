import { requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";
import {
  fetchThroughMachine,
  isChallengePage,
  readWithChrome,
  recordSiteFailure,
  requireSiteOpen,
} from "../web-access";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_TEXT_LENGTH = 40_000;
const MAX_LINKS = 100;

export const hostedWebTools = [
  defineHostedAgentTool(
    "web.read",
    async (context, input) => {
      const url = publicWebUrl(requiredString(input, "url")).toString();
      const page = await fetchPage(context, url);
      return pageFrom(publicWebUrl(page.url), page.body, page.contentType);
    },
    { effect: "read_only" },
  ),
  defineHostedAgentTool(
    "web.search",
    async (context, input) => {
      const query = requiredString(input, "query");
      const page = await fetchPage(
        context,
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      );
      const results = duckDuckGoResults(page.body);
      if (!results.length)
        throw new Error(
          "Search found nothing this time. Try other words, or use the pages you already have.",
        );
      return { query, results };
    },
    { effect: "read_only" },
  ),
];

/**
 * Every page an agent reads, search results included, comes through here: a
 * machine lent to the workspace if one is online, otherwise the cloud, where
 * a site that refuses a plain fetch gets one try in a real browser. A site
 * that keeps failing is closed for the rest of the turn.
 */
async function fetchPage(
  context: Parameters<typeof fetchThroughMachine>[0],
  url: string,
) {
  requireSiteOpen(context.job.id, url);
  const lent = await fetchThroughMachine(context, url);
  if (lent) return lent;
  try {
    return await fetchPlain(url);
  } catch (error) {
    try {
      const page = await readWithChrome(context.env.BROWSER, url);
      return { url: page.url, body: page.html, contentType: "text/html" };
    } catch {
      recordSiteFailure(context.job.id, url);
      throw error;
    }
  }
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function duckDuckGoResults(html: string): SearchResult[] {
  return [
    ...html.matchAll(
      /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gu,
    ),
  ]
    .flatMap(([, link = "", title = "", snippet = ""]) => {
      const target = new URL(decodeHtml(link), "https://duckduckgo.com");
      const url = target.searchParams.get("uddg") ?? target.toString();
      // Ads route through DuckDuckGo's own click tracker.
      if (/duckduckgo\.com\/y\.js/u.test(url)) return [];
      return [{ url, title: plainText(title), snippet: plainText(snippet) }];
    })
    .slice(0, 20);
}

function plainText(html: string) {
  return decodeHtml(html.replace(/<[^>]+>/gu, " "))
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export async function readWebPage(source: string) {
  const page = await fetchPlain(source);
  return pageFrom(publicWebUrl(page.url), page.body, page.contentType);
}

async function fetchPlain(source: string) {
  let url = publicWebUrl(source);
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain,application/json",
        "user-agent": "Chief/1.0 (+https://heychief.sh)",
      },
    });
    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location)
        throw new Error("The web page returned an empty redirect.");
      url = publicWebUrl(new URL(location, url).toString());
      continue;
    }
    // 202 is how some sites, DuckDuckGo among them, turn a bot away.
    if (!response.ok || response.status === 202) {
      throw new Error(`The web page returned HTTP ${response.status}.`);
    }
    const body = await boundedBody(response);
    if (isChallengePage(body))
      throw new Error("The web page returned a bot check instead of content.");
    return {
      url: url.toString(),
      body,
      contentType: response.headers.get("content-type") ?? "",
    };
  }
  throw new Error("The web page redirected too many times.");
}

function pageFrom(url: URL, body: string, contentType: string) {
  if (!contentType.toLowerCase().includes("html"))
    return {
      url: url.toString(),
      title: "",
      text: body.slice(0, MAX_TEXT_LENGTH),
      links: [],
    };
  return htmlPage(url, body);
}

async function boundedBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("The web page is too large to read safely.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    const chunk = new Uint8Array(result.value);
    bytes += chunk.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("The web page is too large to read safely.");
    }
    body += decoder.decode(chunk, { stream: true });
  }
  return body + decoder.decode();
}

function htmlPage(url: URL, html: string) {
  const title = decodeHtml(
    /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? "",
  ).trim();
  const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/giu)]
    .map((match) => safeLink(match[1], url))
    .filter((link): link is string => link !== undefined)
    .filter((link, index, all) => all.indexOf(link) === index)
    .slice(0, MAX_LINKS);
  const pageBody = /<body\b[^>]*>([\s\S]*?)<\/body>/iu.exec(html)?.[1] ?? html;
  const text = decodeHtml(
    pageBody
      .replace(
        /<(?:script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)>/giu,
        " ",
      )
      .replace(/<(?:br|hr)\s*\/?>/giu, "\n")
      .replace(
        /<\/(?:p|div|section|article|header|footer|nav|main|aside|h[1-6]|li|tr)>/giu,
        "\n",
      )
      .replace(/<[^>]+>/gu, " "),
  )
    .replaceAll(/[^\S\n]+/gu, " ")
    .replaceAll(/\n[ \t]*/gu, "\n")
    .replaceAll(/\n{2,}/gu, "\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
  return { url: url.toString(), title, text, links };
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/gu, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

function safeLink(value: string | undefined, base: URL) {
  if (!value || value.startsWith("#")) return undefined;
  try {
    return publicWebUrl(new URL(value, base).toString()).toString();
  } catch {
    return undefined;
  }
}

function publicWebUrl(source: string) {
  const url = new URL(source);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    isPrivateHostname(url.hostname)
  ) {
    throw new Error("Web URLs must identify a public HTTP or HTTPS page.");
  }
  return url;
}

function isPrivateHostname(source: string) {
  const hostname = source.replace(/^\[|\]$/gu, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "::1" ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  ) {
    return true;
  }
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isRedirect(status: number) {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}
