import { channelOpenApiPaths, channelOpenApiSchemas } from "@chief/channel-api";

const requestBody = (schema: string) => ({
  required: true,
  content: {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schema}` },
    },
  },
});

const document = {
  openapi: "3.1.0",
  info: {
    title: "Chief Agent CLI",
    version: "0.1.0",
    description:
      "The loopback-only channel, message and scheduled-work contract used by Chief agents.",
  },
  servers: [
    {
      url: "http://127.0.0.1:4318",
      description: "Chief local runtime",
    },
  ],
  security: [{ localAgentCapability: [] }],
  paths: channelOpenApiPaths(requestBody),
  components: {
    securitySchemes: {
      localAgentCapability: {
        type: "http",
        scheme: "bearer",
        description:
          "A random loopback-only capability supplied to the active Chief agent runtime.",
      },
    },
    schemas: channelOpenApiSchemas,
  },
};

export function GET() {
  return Response.json(document, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      "Content-Disposition": 'inline; filename="chief-agent-cli.json"',
    },
  });
}
