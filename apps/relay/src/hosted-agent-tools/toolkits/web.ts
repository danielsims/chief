import { requiredString } from "../input";
import { defineHostedAgentTool } from "../tool";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_TEXT_LENGTH = 40_000;
const MAX_LINKS = 100;

export const hostedWebTools = [
  defineHostedAgentTool(
    "web.read",
    async (_context, input) => await readWebPage(requiredString(input, "url")),
    { effect: "read_only" },
  ),
];

export async function readWebPage(source: string) {
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
    if (!response.ok) {
      throw new Error(`The web page returned HTTP ${response.status}.`);
    }
    const body = await boundedBody(response);
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (!contentType?.includes("html")) {
      return {
        url: url.toString(),
        title: "",
        text: body.slice(0, MAX_TEXT_LENGTH),
        links: [],
      };
    }
    return htmlPage(url, body);
  }
  throw new Error("The web page redirected too many times.");
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
