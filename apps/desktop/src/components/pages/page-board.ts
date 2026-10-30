import { pageComponents, parsePageDocument } from "@chief/relay-contracts";

/** A named board artifact is a view of its source, never a copy of its rows. */
export function pageBoard(content: string | undefined) {
  if (!content) return undefined;
  const parsed = parsePageDocument(content);
  if (!parsed.success) return undefined;
  const root = parsed.page.spec.elements[parsed.page.spec.root];
  const props =
    root?.type === "Board" &&
    (root.visible === undefined || root.visible === true)
      ? pageComponents.Board.props.safeParse(root.props)
      : undefined;
  return props?.success ? parsed.page.sources?.[props.data.source] : undefined;
}
