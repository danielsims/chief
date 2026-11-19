import type { GenerativePartRenderer } from "../types";
import { DraftCard } from "../../chat/draft-card";

const renderer: GenerativePartRenderer = {
  partType: "data-draft",
  render: (part) =>
    part.type === "data-draft" ? <DraftCard data={part.data} /> : undefined,
};

export default renderer;
