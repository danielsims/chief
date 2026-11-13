import type {
  ActionItem,
  AnalyticsDataset,
  CampaignRecord,
  ContentDraftRecord,
  RecurringWorkRecord,
  SessionRecord,
  TrendRecord,
} from "@chief/agent-runtime/types";

export interface WorkspaceDataState {
  trends: TrendRecord[];
  analyticsDatasets: AnalyticsDataset[];
  drafts: ContentDraftRecord[];
  campaigns: CampaignRecord[];
  recurringWork: RecurringWorkRecord[];
  activity: SessionRecord[];
  actionItems: ActionItem[];
}

export const emptyWorkspaceData: WorkspaceDataState = {
  trends: [],
  analyticsDatasets: [],
  drafts: [],
  campaigns: [],
  recurringWork: [],
  activity: [],
  actionItems: [],
};

export type WorkspaceDataSnapshot = Partial<WorkspaceDataState>;

export function normalizeWorkspaceData(
  snapshot: WorkspaceDataSnapshot,
): WorkspaceDataState {
  return {
    trends: snapshot.trends ?? [],
    analyticsDatasets: snapshot.analyticsDatasets ?? [],
    drafts: snapshot.drafts ?? [],
    campaigns: snapshot.campaigns ?? [],
    recurringWork: snapshot.recurringWork ?? [],
    activity: snapshot.activity ?? [],
    actionItems: snapshot.actionItems ?? [],
  };
}
