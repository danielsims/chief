/**
 * Chief's code theme, in light and dark: the app's own surfaces and text with
 * quiet Geist-style accents, so code reads like the rest of the interface.
 * Plain TextMate theme data, so any highlighter can register it.
 */
interface Palette {
  background: string;
  foreground: string;
  muted: string;
  comment: string;
  keyword: string;
  string: string;
  fn: string;
  constant: string;
  type: string;
  tag: string;
  attribute: string;
  property: string;
}

const dark: Palette = {
  background: "#0d0d0d", // --background, hsl(0 0% 5%)
  foreground: "#ededed",
  muted: "#8f8f8f",
  comment: "#6e6e6e",
  keyword: "#f47ba0", // Geist pink, softened
  string: "#6fcf8a", // Geist green, softened
  fn: "#c99bf7", // Geist purple, softened
  constant: "#6cb6ff", // Geist blue, softened
  type: "#e5c07b",
  tag: "#f47ba0",
  attribute: "#c99bf7",
  property: "#d4d4d4",
};

const light: Palette = {
  background: "#ffffff",
  foreground: "#171717",
  muted: "#6b6b6b",
  comment: "#8f8f8f",
  keyword: "#c4305f",
  string: "#2a7a3f",
  fn: "#7d44b8",
  constant: "#0b62c4",
  type: "#9a6700",
  tag: "#c4305f",
  attribute: "#7d44b8",
  property: "#3d3d3d",
};

function theme(
  name: string,
  displayName: string,
  type: "dark" | "light",
  p: Palette,
) {
  const rule = (scope: string[], foreground: string, fontStyle?: string) => ({
    scope,
    settings: fontStyle ? { foreground, fontStyle } : { foreground },
  });
  return {
    name,
    displayName,
    type,
    colors: {
      "editor.background": p.background,
      "editor.foreground": p.foreground,
    },
    tokenColors: [
      rule(["comment", "punctuation.definition.comment"], p.comment, "italic"),
      rule(
        [
          "keyword",
          "storage",
          "storage.type",
          "storage.modifier",
          "keyword.operator.new",
          "keyword.control",
        ],
        p.keyword,
      ),
      rule(
        ["keyword.operator", "punctuation", "meta.brace", "meta.delimiter"],
        p.muted,
      ),
      rule(
        [
          "string",
          "string.quoted",
          "string.template",
          "punctuation.definition.string",
        ],
        p.string,
      ),
      rule(
        [
          "entity.name.function",
          "support.function",
          "meta.function-call.generic",
          "variable.function",
        ],
        p.fn,
      ),
      rule(
        [
          "constant.numeric",
          "constant.language",
          "constant.character",
          "variable.other.constant",
          "support.constant",
        ],
        p.constant,
      ),
      rule(
        [
          "entity.name.type",
          "support.type",
          "support.class",
          "entity.name.class",
          "entity.other.inherited-class",
        ],
        p.type,
      ),
      rule(["entity.name.tag", "support.class.component"], p.tag),
      rule(["entity.other.attribute-name"], p.attribute),
      rule(
        [
          "variable.other.property",
          "meta.object-literal.key",
          "support.type.property-name",
        ],
        p.property,
      ),
      rule(
        ["variable", "variable.other.readwrite", "meta.definition.variable"],
        p.foreground,
      ),
      rule(["markup.inserted"], p.string),
      rule(["markup.deleted"], p.keyword),
    ],
  };
}

export const chiefDarkCodeTheme = theme(
  "chief-dark",
  "Chief (Dark)",
  "dark",
  dark,
);
export const chiefLightCodeTheme = theme(
  "chief-light",
  "Chief (Light)",
  "light",
  light,
);

/** The theme names, as a highlighter's `{ dark, light }` option. */
export const chiefCodeThemes = {
  dark: chiefDarkCodeTheme.name,
  light: chiefLightCodeTheme.name,
} as const;
