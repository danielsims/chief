import { generatedDocument } from "../generated-openapi";

export function GET() {
  return Response.json(generatedDocument, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Content-Disposition": 'inline; filename="chief-local-tools.json"',
    },
  });
}
