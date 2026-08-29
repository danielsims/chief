import { Link } from "react-router";

import { Button } from "@chief/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@chief/ui/components/card";

export function AgentsSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
        <CardDescription>
          Configure the provider and model assigned to each workspace agent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-6 rounded-xl border p-4">
          <div>
            <p className="text-sm font-medium">Agent team</p>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              Agent settings belong to the logical agent and follow it across
              deployment locations.
            </p>
          </div>
          <Button variant="outline" render={<Link to="/agents" />}>
            Manage agents
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
