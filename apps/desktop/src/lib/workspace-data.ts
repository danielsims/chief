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

export type WorkspaceDataSnapshot = Partial<WorkspaceDataState>;

export function normalizeWorkspaceData(
  snapshot: WorkspaceDataSnapshot,
): WorkspaceDataState {
  return {
    prospects: snapshot.prospects ?? [],
    trends: snapshot.trends ?? [],
    analyticsDatasets: snapshot.analyticsDatasets ?? [],
    drafts: snapshot.drafts ?? [],
    campaigns: snapshot.campaigns ?? [],
    recurringWork: snapshot.recurringWork ?? [],
    activity: snapshot.activity ?? [],
    actionItems: snapshot.actionItems ?? [],
    waysOfWorking: (() => {
      const value = snapshot.waysOfWorking;
      return {
        mode: value?.mode ?? "mission-control",
        missionControlChannelId:
          value?.missionControlChannelId ?? DEFAULT_MISSION_CONTROL_CHANNEL_ID,
        updatedAt: value?.updatedAt ?? 0,
      };
    })(),
  };
}
