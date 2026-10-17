import type { GenerativePartRenderer } from "../types";
import { QuestionCard } from "../../chat/question-card";

const renderer: GenerativePartRenderer = {
  partType: "data-question",
  render: (part) =>
    part.type === "data-question" ? (
      <QuestionCard question={part.data} />
    ) : undefined,
};

export default renderer;
