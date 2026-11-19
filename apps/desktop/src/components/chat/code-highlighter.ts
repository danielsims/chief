import type { CodeHighlighterPlugin } from "@streamdown/code";
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from "shiki";

import {
  chiefCodeThemes,
  chiefDarkCodeTheme,
  chiefLightCodeTheme,
} from "@chief/ui/lib/code-theme";

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;
type Shiki = typeof import("shiki");

let shiki: Shiki | undefined;
let ready: Highlighter | undefined;
let starting: Promise<Highlighter> | undefined;
const loading = new Map<BundledLanguage, Promise<void>>();

/** Shiki and one highlighter for every code block, made on first use. */
function highlighter() {
  starting ??= Promise.all([
    import("shiki"),
    import("shiki/engine/javascript"),
  ]).then(async ([module, { createJavaScriptRegexEngine }]) => {
    shiki = module;
    ready = await module.createHighlighter({
      themes: [chiefLightCodeTheme, chiefDarkCodeTheme],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
    return ready;
  });
  return starting;
}

function isBundled(module: Shiki, id: string): id is BundledLanguage {
  return id in module.bundledLanguages;
}

function bundledLanguage(name: string): BundledLanguage | undefined {
  if (!shiki) return undefined;
  const id = name.trim().toLowerCase();
  const alias = shiki.bundledLanguagesInfo.find((info) =>
    info.aliases?.includes(id),
  )?.id;
  const resolved = alias ?? id;
  return isBundled(shiki, resolved) ? resolved : undefined;
}

/** The themes' own text colours, for tokens no grammar coloured. */
const plainText = {
  color: chiefLightCodeTheme.colors["editor.foreground"],
  "--shiki-dark": chiefDarkCodeTheme.colors["editor.foreground"],
};

function tokens(
  instance: Highlighter,
  code: string,
  language?: BundledLanguage,
) {
  const result = instance.codeToTokens(code, {
    lang: language ?? "text",
    themes: chiefCodeThemes,
  });
  // Plain text comes back uncoloured; colouring it marks the block done.
  return {
    ...result,
    tokens: result.tokens.map((line) =>
      line.map((token) =>
        token.htmlStyle?.color
          ? token
          : { ...token, htmlStyle: { ...token.htmlStyle, ...plainText } },
      ),
    ),
  };
}

/**
 * Streamdown's code highlighting in Chief's own themes. Shiki and each
 * language load only when a block needs them, so nothing slows the app's
 * start; until a block's colours arrive it shows as a skeleton (see
 * `index.css`), and once its language is loaded it colours as it's drawn.
 */
export const chiefCodeHighlighter: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  // Unknown languages are shown as plain text, so every block is accepted.
  supportsLanguage: () => true,
  getSupportedLanguages: () => [],
  getThemes: () => [chiefLightCodeTheme, chiefDarkCodeTheme],
  highlight({ code, language }, done) {
    const lang = bundledLanguage(language);
    if (ready && (!lang || ready.getLoadedLanguages().includes(lang)))
      return tokens(ready, code, lang);
    void highlighter()
      .then(async (instance) => {
        const resolved = bundledLanguage(language);
        if (resolved && !instance.getLoadedLanguages().includes(resolved)) {
          const load = loading.get(resolved) ?? instance.loadLanguage(resolved);
          loading.set(resolved, load);
          await load;
        }
        done?.(tokens(instance, code, resolved));
      })
      .catch((error: unknown) =>
        console.warn("[Code] Couldn't highlight a code block:", error),
      );
    return null;
  },
};
