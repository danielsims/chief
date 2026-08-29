import { BarChart3 } from "lucide-react";

import { PageTitle } from "../components/page-title";

export function AnalyticsPage() {
  return (
    <div className="flex h-full flex-col px-8 py-7">
      <PageTitle>Analytics</PageTitle>
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-sm text-center">
          <BarChart3 className="text-muted-foreground mx-auto size-5" />
          <p className="mt-4 text-sm font-medium">No reports yet</p>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            Ask an agent to analyze a connected source. Saved reports will
            appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
