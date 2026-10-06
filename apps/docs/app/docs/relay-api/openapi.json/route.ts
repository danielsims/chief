import generatedOpenApi from "../../../../generated/relay-openapi.json";

export function GET() {
  return Response.json(generatedOpenApi, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Content-Disposition": 'inline; filename="chief-relay-openapi.json"',
    },
  });
}
