import type { CodeHighlighterPlugin } from "@streamdown/code";
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from "shiki";
import {
  bundledLanguages,
  bundledLanguagesInfo,
  createHighlighter,
} from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import {
  chiefCodeThemes,
  chiefDarkCodeTheme,
  chiefLightCodeTheme,
} from "@chief/ui/lib/code-theme";

/** The languages agents write most, loaded with the app so they're ready. */
const commonLanguages: BundledLanguage[] = [
  "tsx",
  "typescript",
  "jsx",
  "javascript",
  "json",
  "bash",
  "shellscript",
  "python",
  "html",
  "css",
  "markdown",
  "yaml",
  "sql",
  "rust",
  "go",
  "diff",
];

const aliases = new Map(
  bundledLanguagesInfo.flatMap((info) =>
    (info.aliases ?? []).map((alias) => [alias, info.id] as const),
  ),
);
function isBundledLanguage(id: string): id is BundledLanguage {
  return id in bundledLanguages;
}

function bundledLanguage(name: string): BundledLanguage | undefined {
  const id = name.trim().toLowerCase();
  const resolved = aliases.get(id) ?? id;
  return isBundledLanguage(resolved) ? resolved : undefined;
}

let ready: HighlighterGeneric<BundledLanguage, BundledTheme> | undefined;
// One highlighter for every code block, created once at start.
const highlighter = createHighlighter({
  themes: [chiefLightCodeTheme, chiefDarkCodeTheme],
  langs: commonLanguages,
  engine: createJavaScriptRegexEngine({ forgiving: true }),
}).then((created) => {
  ready = created;
  return created;
});
const loading = new Map<BundledLanguage, Promise<void>>();

function tokens(
  instance: HighlighterGeneric<BundledLanguage, BundledTheme>,
  code: string,
  language: BundledLanguage | "text",
) {
  return instance.codeToTokens(code, {
    lang: language,
    themes: chiefCodeThemes,
  });
}

/**
 * Streamdown's code highlighting in Chief's own themes. A block in a loaded
 * language is highlighted as it's drawn, so it never shows uncoloured first;
 * a rarer language loads once, then its blocks colour in.
 */
export const chiefCodeHighlighter: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  supportsLanguage: (language) => bundledLanguage(language) !== undefined,
  getSupportedLanguages: () =>
    Object.keys(bundledLanguages).filter(isBundledLanguage),
  getThemes: () => [chiefLightCodeTheme, chiefDarkCodeTheme],
  highlight({ code, language }, done) {
    const lang = bundledLanguage(language);
    if (ready && (!lang || ready.getLoadedLanguages().includes(lang)))
      return tokens(ready, code, lang ?? "text");
    void highlighter
      .then(async (instance) => {
        if (lang && !instance.getLoadedLanguages().includes(lang)) {
          const load = loading.get(lang) ?? instance.loadLanguage(lang);
          loading.set(lang, load);
          await load;
        }
        done?.(tokens(instance, code, lang ?? "text"));
      })
      .catch((error: unknown) =>
        console.warn("[Code] Couldn't highlight a code block:", error),
      );
    return null;
  },
};
