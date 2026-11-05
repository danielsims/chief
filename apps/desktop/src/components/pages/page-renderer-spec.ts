import type { Spec } from "@json-render/core";
import { VisibilityConditionSchema } from "@json-render/core";

import type { PageSpec } from "@chief/relay-contracts";

export function rendererSpec(page: PageSpec): Spec {
  return {
    root: page.root,
    ...(page.state ? { state: page.state } : undefined),
    elements: Object.fromEntries(
      Object.entries(page.elements).map(([key, element]) => {
        const visible = VisibilityConditionSchema.safeParse(element.visible);
        return [
          key,
          {
            ...element,
            visible:
              element.visible === undefined
                ? undefined
                : visible.success
                  ? visible.data
                  : false,
          },
        ];
      }),
    ),
  };
}
