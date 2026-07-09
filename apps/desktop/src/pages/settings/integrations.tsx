import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@marketer/ui/components/card";
import { Button } from "@marketer/ui/components/button";

const integrations = [
  { name: "Google Analytics", detail: "Website traffic, signups, funnels" },
  { name: "Google Ads", detail: "Campaign performance and spend" },
  { name: "X (Twitter)", detail: "Posts, engagement, trends" },
  { name: "Reddit", detail: "Communities and conversations" },
  { name: "LinkedIn", detail: "Company page content" },
  { name: "Instagram", detail: "Posts and reels" },
  { name: "TikTok", detail: "Video content performance" },
];

export function IntegrationsSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>
          OAuth connections are handled locally. Nothing leaves your machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {integrations.map((integration) => (
          <div
            key={integration.name}
            className="flex items-center justify-between py-3"
          >
            <div>
              <p className="text-sm font-medium">{integration.name}</p>
              <p className="text-xs text-muted-foreground">
                {integration.detail}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled>
              Connect
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
