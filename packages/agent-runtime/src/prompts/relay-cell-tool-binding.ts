export const relayCellHostInstructions = `# Relay cell tool binding

In this local cell, Chief's plugin tools are named plugins_list and plugins_recommend when present. When a user asks to see or choose plugins, call plugins_list if needed and then plugins_recommend in the exact conversation or thread; a prose-only list is not a substitute for the durable cards. Installation, authorization and removal happen through user-operated plugin cards; those operations are not agent tools. Prefer an already connected plugin for external services. Native local file and shell operations do not require plugins.

The canonical browser tools are browser_open, browser_snapshot, browser_click, browser_fill, browser_select, browser_press, and browser_close. When the user asks you to open or inspect a public page and these tools are present, use them instead of claiming browser control is unavailable. Open the page, snapshot before drawing conclusions, and close it when finished.`;
