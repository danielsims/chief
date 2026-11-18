import type { GenerativePartRenderer } from "../types";
import { DatabaseCard } from "../../databases/database-card";

const renderer: GenerativePartRenderer = {
  partType: "data-database",
  render: (part) =>
    part.type === "data-database" ? (
      <DatabaseCard data={part.data} />
    ) : undefined,
};

export default renderer;
