import type { GenerativePartRenderer } from "../types";

const resultTableRenderer: GenerativePartRenderer = {
  partType: "data-table",
  render(part) {
    if (part.type !== "data-table") return undefined;
    return (
      <section className="border bg-card">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-medium">{part.data.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {part.data.subtitle ??
              `${part.data.rows.length} ${part.data.rows.length === 1 ? "item" : "items"}`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {part.data.columns.map((column) => (
                  <th
                    key={column.key}
                    className="border-b px-4 py-2 font-medium"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {part.data.rows.map((row, index) => (
                <tr
                  key={`${part.id ?? "table"}-${index}`}
                  className="border-b last:border-b-0"
                >
                  {part.data.columns.map((column) => (
                    <td
                      key={column.key}
                      className="max-w-72 truncate px-4 py-2.5"
                    >
                      {String(row[column.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  },
};

export default resultTableRenderer;
