import type {
  ActionItem,
  AnalyticsDataset,
  CampaignRecord,
  ContentDraftRecord,
  ProspectRecord,
  RecurringWorkRecord,
  SessionRecord,
  TrendRecord,
} from "@chief/agent-runtime/types";

export interface WorkspaceDataState {
  prospects: ProspectRecord[];
  trends: TrendRecord[];
  analyticsDatasets: AnalyticsDataset[];
  drafts: ContentDraftRecord[];
  campaigns: CampaignRecord[];
  recurringWork: RecurringWorkRecord[];
  activity: SessionRecord[];
  actionItems: ActionItem[];
}

export const emptyWorkspaceData: WorkspaceDataState = {
  prospects: [],
  trends: [],
  analyticsDatasets: [],
  drafts: [],
  campaigns: [],
  recurringWork: [],
  activity: [],
  actionItems: [],
};

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Keep older runtime snapshots from leaking missing collections into React. */
export function normalizeWorkspaceData(value: unknown): WorkspaceDataState {
  const snapshot =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    prospects: arrayValue<ProspectRecord>(snapshot.prospects),
    trends: arrayValue<TrendRecord>(snapshot.trends),
    analyticsDatasets: arrayValue<AnalyticsDataset>(snapshot.analyticsDatasets),
    drafts: arrayValue<ContentDraftRecord>(snapshot.drafts),
    campaigns: arrayValue<CampaignRecord>(snapshot.campaigns),
    recurringWork: arrayValue<RecurringWorkRecord>(snapshot.recurringWork),
    activity: arrayValue<SessionRecord>(snapshot.activity),
    actionItems: arrayValue<ActionItem>(snapshot.actionItems),
  };
}
