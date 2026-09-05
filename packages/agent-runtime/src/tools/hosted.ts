import {
  listRecurringWorkDefinition,
  proposeRecurringWorkDefinition,
} from "./toolkits/automation/recurring-work-definitions.js";
import { clickBrowserDefinition } from "./toolkits/browser/click-browser.js";
import { closeBrowserDefinition } from "./toolkits/browser/close-browser.js";
import { fillBrowserDefinition } from "./toolkits/browser/fill-browser.js";
import { openBrowserDefinition } from "./toolkits/browser/open-browser.js";
import { selectBrowserDefinition } from "./toolkits/browser/select-browser.js";
import { snapshotBrowserDefinition } from "./toolkits/browser/snapshot-browser.js";
import { addChannelMembersDefinition } from "./toolkits/channels/add-channel-members.js";
import { createChannelDefinition } from "./toolkits/channels/create-channel.js";
import { listChannelMembersDefinition } from "./toolkits/channels/list-channel-members.js";
import { listChannelsDefinition } from "./toolkits/channels/list-channels.js";
import { listChannelMessagesDefinition } from "./toolkits/channels/messages/list-channel-messages.js";
import { postChannelMessageDefinition } from "./toolkits/channels/messages/post-channel-message.js";
import { computerEditFileDefinition } from "./toolkits/computer/edit-file.js";
import { computerExecuteCommandDefinition } from "./toolkits/computer/execute-command.js";
import { computerGitDefinition } from "./toolkits/computer/git.js";
import { computerListFilesDefinition } from "./toolkits/computer/list-files.js";
import { computerPublishArtifactDefinition } from "./toolkits/computer/publish-artifact.js";
import { computerReadFileDefinition } from "./toolkits/computer/read-file.js";
import { computerWriteFileDefinition } from "./toolkits/computer/write-file.js";
import { missionToolDefinitions } from "./toolkits/missions.js";
import {
  listFilesDefinition,
  readFileDefinition,
  writeFileDefinition,
} from "./toolkits/files/definitions.js";
import { listPluginsDefinition } from "./toolkits/plugins/list-plugins.js";
import { recommendPluginsDefinition } from "./toolkits/plugins/recommend-plugins.js";
import { recommendProjectDefinition } from "./toolkits/projects/recommend-project.js";
import { listProspectsDefinition } from "./toolkits/research/list-prospects.js";
import { saveProspectDefinition } from "./toolkits/research/save-prospect.js";
import { delegateSpecialistDefinition } from "./toolkits/specialists/delegate-specialist-definition.js";
import { readWebPageDefinition } from "./toolkits/web/read-web-page.js";
import { getBrandProfileStatusDefinition } from "./toolkits/workspace/get-brand-profile-status.js";
import { saveBrandProfileDefinition } from "./toolkits/workspace/save-brand-profile.js";

export const hostedAgentToolDefinitions = {
  base: [
    ...missionToolDefinitions,
    listRecurringWorkDefinition,
    proposeRecurringWorkDefinition,
    listFilesDefinition,
    readFileDefinition,
    writeFileDefinition,
    computerReadFileDefinition,
    computerListFilesDefinition,
    computerWriteFileDefinition,
    computerEditFileDefinition,
    computerExecuteCommandDefinition,
    computerGitDefinition,
    computerPublishArtifactDefinition,
    listChannelsDefinition,
    createChannelDefinition,
    addChannelMembersDefinition,
    listChannelMembersDefinition,
    listChannelMessagesDefinition,
    postChannelMessageDefinition,
    listPluginsDefinition,
    recommendPluginsDefinition,
    recommendProjectDefinition,
    getBrandProfileStatusDefinition,
    saveBrandProfileDefinition,
    listProspectsDefinition,
    saveProspectDefinition,
    delegateSpecialistDefinition,
    readWebPageDefinition,
  ],
  browser: [
    openBrowserDefinition,
    snapshotBrowserDefinition,
    clickBrowserDefinition,
    fillBrowserDefinition,
    selectBrowserDefinition,
    closeBrowserDefinition,
  ],
} as const;
