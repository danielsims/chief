import { registerCustomTheme } from "@pierre/diffs";

import {
  chiefCodeThemes,
  chiefDarkCodeTheme,
  chiefLightCodeTheme,
} from "@chief/ui/lib/code-theme";

registerCustomTheme(chiefDarkCodeTheme.name, () =>
  Promise.resolve(chiefDarkCodeTheme),
);
registerCustomTheme(chiefLightCodeTheme.name, () =>
  Promise.resolve(chiefLightCodeTheme),
);

/** Every code view and diff uses Chief's own theme. Its size is set in index.css. */
export const codeTheme = chiefCodeThemes;
