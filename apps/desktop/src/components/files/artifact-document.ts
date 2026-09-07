import type { DefaultTreeAdapterMap } from "parse5";
import { html, parseFragment, serialize } from "parse5";

// Parse without a browser document, so even discarded resource elements cannot fetch.
const elements = new Set(
  "a abbr article aside b blockquote br button caption code col colgroup dd del details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img kbd li main mark nav ol p pre s section small span strong style sub summary sup table tbody td th thead time tr u ul".split(
    " ",
  ),
);
const attributes = new Set(
  "class id style title alt width height colspan rowspan scope open datetime".split(
    " ",
  ),
);

function sanitize(parent: DefaultTreeAdapterMap["parentNode"]) {
  parent.childNodes = parent.childNodes.filter((node) => {
    if (node.nodeName === "#text") return true;
    if (
      !("tagName" in node) ||
      node.namespaceURI !== html.NS.HTML ||
      !elements.has(node.tagName)
    )
      return false;
    node.attrs = node.attrs.filter((attribute) => {
      if (attribute.namespace || attribute.prefix) return false;
      if (attributes.has(attribute.name) || attribute.name.startsWith("aria-"))
        return true;
      return (
        node.tagName === "img" &&
        attribute.name === "src" &&
        /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/iu.test(
          attribute.value,
        )
      );
    });
    sanitize(node);
    return true;
  });
}

/** Static, opaque-origin preview. Navigation and executable markup are discarded. */
export function artifactDocument(content: string) {
  const fragment = parseFragment(content);
  sanitize(fragment);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark}body{margin:0;padding:24px;font:14px/1.6 system-ui,sans-serif}*{box-sizing:border-box}button,input,select{font:inherit}</style></head><body>${serialize(fragment)}</body></html>`;
}
