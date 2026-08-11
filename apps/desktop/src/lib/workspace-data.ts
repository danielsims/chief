import type {
  ActionItem,
  AnalyticsDataset,
  CampaignRecord,
  ContentDraftRecord,
  ProspectRecord,
  RecurringWorkRecord,
  SessionRecord,
  TrendRecord,
  WorkspaceWaysOfWorking,
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
  waysOfWorking: WorkspaceWaysOfWorking;
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
  waysOfWorking: {
    mode: "mission-control",
    missionControlChannelId: "ce83fa02-5d8d-4fc1-9e31-f670676b0741",
    updatedAt: 0,
  },
};

const DEFAULT_MISSION_CONTROL_CHANNEL_ID =
  "ce83fa02-5d8d-4fc1-9e31-f670676b0741";

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
    waysOfWorking: (() => {
      if (
        !snapshot.waysOfWorking ||
        typeof snapshot.waysOfWorking !== "object"
      ) {
        return emptyWorkspaceData.waysOfWorking;
      }
      const value = snapshot.waysOfWorking as Partial<WorkspaceWaysOfWorking>;
      return {
        mode: value.mode ?? "mission-control",
        missionControlChannelId:
          value.missionControlChannelId ?? DEFAULT_MISSION_CONTROL_CHANNEL_ID,
        updatedAt: value.updatedAt ?? 0,
      };
    })(),
  };
}
