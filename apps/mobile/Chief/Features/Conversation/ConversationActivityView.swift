import SwiftUI

/// Full-width counterpart to the desktop activity panel. Mission Control
/// aggregates delegated cells; ordinary channels stay conversation-scoped.
struct ConversationActivityView: View {
  @Environment(AppModel.self) private var model
  let conversationID: String

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 22) {
        if !workingAgents.isEmpty {
          activitySection("Working now") {
            agentLinks(workingAgents, working: true)
          }
        }

        if !historicalAgents.isEmpty {
          activitySection(workingAgents.isEmpty ? "Agent activity" : "Earlier activity") {
            agentLinks(historicalAgents, working: false)
          }
        }

        if workingAgents.isEmpty && historicalAgents.isEmpty {
          ContentUnavailableView(
            "No activity yet",
            systemImage: "waveform.path.ecg",
            description: Text("Thinking and tool calls for this conversation will appear here.")
          )
          .frame(maxWidth: .infinity)
          .padding(.top, 72)
        }
      }
      .padding(ChiefTheme.pagePadding)
    }
    .background(ChiefTheme.background)
    .navigationTitle("Activity")
    .navigationBarTitleDisplayMode(.inline)
    .task { await model.refreshAgentJobs() }
  }

  private var workingAgents: [AgentActivityPresence] {
    model.workingAgentPresences(
      workspaceID: model.workspace?.id,
      conversationID: conversationID
    )
  }

  private var historicalAgents: [AgentActivityPresence] {
    let liveIDs = Set(
      model.activityRecords(
        workspaceID: model.workspace?.id,
        conversationID: conversationID
      ).map(\.agentID)
    )
    let durableIDs = Set(activityMessages.compactMap(\.author.agentID))
    let durableJobIDs = Set(
      model.failedAgentJobs(
        workspaceID: model.workspace?.id,
        conversationID: conversationID
      ).map(\.agentId)
    )
    let workingIDs = Set(workingAgents.map(\.id))
    let ids = liveIDs.union(durableIDs).union(durableJobIDs).subtracting(workingIDs)
    let roster = model.workspace?.agents ?? []
    let rosterOrder = Dictionary(
      uniqueKeysWithValues: roster.enumerated().map { ($0.element.id, $0.offset) }
    )
    return ids.sorted { left, right in
      let leftOrder = rosterOrder[left] ?? .max
      let rightOrder = rosterOrder[right] ?? .max
      return leftOrder == rightOrder ? left < right : leftOrder < rightOrder
    }.map { id in
      AgentActivityPresence(
        id: id,
        name: roster.first(where: { $0.id == id })?.name
          ?? WorkspaceAgentCatalog.agent(forID: id)?.name
          ?? id.capitalized
      )
    }
  }

  private var activityMessages: [ConversationMessage] {
    scopedMessages.filter { message in
      message.components.contains {
        $0.kind == "thinking" || $0.kind == "tool" || $0.kind == "error"
      }
    }
  }

  private var scopedMessages: [ConversationMessage] {
    guard let workspace = model.workspace else { return [] }
    let ids = conversationID == "mission-control"
      ? workspace.conversations.map(\.id)
      : [conversationID]
    return ids.flatMap { id in
      model.conversations.messages(workspaceID: workspace.id, conversationID: id)
    }.sorted { $0.createdAt < $1.createdAt }
  }

  private func latestActivityDescription(for agentID: String) -> String {
    if workingAgents.contains(where: { $0.id == agentID }) { return "Working now" }
    if let failedJob = model.failedAgentJobs(
      workspaceID: model.workspace?.id,
      conversationID: conversationID,
      agentID: agentID
    ).first {
      return failedJob.lastError ?? "Run interrupted"
    }
    if let error = model.activityRecords(
      workspaceID: model.workspace?.id,
      conversationID: conversationID,
      agentID: agentID
    ).flatMap(\.components).first(where: { $0.kind == "error" }) {
      return error.payload["message"] ?? error.payload["title"] ?? "Run failed"
    }
    let messageDate = activityMessages.last(where: { $0.author.agentID == agentID })?.createdAt
    let recordDate = model.activityRecords(
      workspaceID: model.workspace?.id,
      conversationID: conversationID,
      agentID: agentID
    ).first?.updatedAt
    guard let latest = [messageDate, recordDate].compactMap({ $0 }).max() else {
      return "Activity available"
    }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .full
    return "Last activity \(formatter.localizedString(for: latest, relativeTo: .now))"
  }

  private func agentLinks(_ agents: [AgentActivityPresence], working: Bool) -> some View {
    VStack(spacing: 5) {
      ForEach(agents) { agent in
        NavigationLink {
          AgentActivityDetailView(conversationID: conversationID, agentID: agent.id)
        } label: {
          AgentActivityNavigationRow(
            agent: agent,
            detail: working ? "Working in this conversation" : latestActivityDescription(for: agent.id),
            working: workingAgents.contains { $0.id == agent.id }
          )
        }
        .buttonStyle(.plain)
        .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
      }
    }
  }

  private func activitySection<Content: View>(
    _ title: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 9) {
      Text(title)
        .font(.system(size: 12))
        .foregroundStyle(ChiefTheme.secondary)
      content()
    }
  }
}

private struct AgentActivityNavigationRow: View {
  let agent: AgentActivityPresence
  let detail: String
  let working: Bool

  var body: some View {
    HStack(spacing: 11) {
      ZStack {
        RoundedRectangle(cornerRadius: 8, style: .continuous)
          .fill(ChiefTheme.agentColor(agent.id).opacity(0.12))
        if working {
          MatrixLoader(size: 17)
            .foregroundStyle(ChiefTheme.agentColor(agent.id))
        } else {
          AgentMark(name: agent.name, size: 28)
        }
      }
      .frame(width: 34, height: 34)

      VStack(alignment: .leading, spacing: 2) {
        Text(agent.name).font(.system(size: 14, weight: .semibold))
        Text(detail)
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(2)
      }
      Spacer(minLength: 8)
      Image(systemName: "chevron.right")
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(ChiefTheme.tertiary)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .contentShape(Rectangle())
  }
}

struct AgentActivityDetailView: View {
  @Environment(AppModel.self) private var model
  let conversationID: String
  let agentID: String

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        if isWorking {
          HStack(spacing: 10) {
            MatrixLoader(size: 17).foregroundStyle(ChiefTheme.agentColor(agentID))
            Text("\(agentName) is working")
              .font(.system(size: 13, weight: .medium))
              .foregroundStyle(ChiefTheme.secondary)
          }
          .padding(.vertical, 4)
        }

        ForEach(failedJobs) { job in
          activityGroup(
            title: conversationName(job.payload.conversationId ?? conversationID),
            date: job.updatedDate,
            components: [failureComponent(for: job)],
            active: false,
            onRetry: { Task { await model.retryAgentJob(job) } }
          )
        }

        ForEach(liveRecords) { record in
          activityGroup(
            title: record.conversationID == conversationID
              ? "Current work" : "#\(conversationName(record.conversationID))",
            date: record.updatedAt,
            components: failedJobs.isEmpty
              ? record.components
              : record.components.filter { $0.kind != "error" },
            active: record.isWorking
          )
        }

        ForEach(durableMessages) { message in
          activityGroup(
            title: conversationName(message.conversationID),
            date: message.createdAt,
            components: activityComponents(in: message),
            active: false
          )
        }

        if !isWorking && failedJobs.isEmpty && liveRecords.isEmpty && durableMessages.isEmpty {
          ContentUnavailableView(
            "No recorded activity",
            systemImage: "waveform.path.ecg",
            description: Text("This agent hasn't used a tool in this conversation yet.")
          )
          .frame(maxWidth: .infinity)
          .padding(.top, 72)
        }
      }
      .padding(ChiefTheme.pagePadding)
    }
    .background(ChiefTheme.background)
    .navigationTitle("\(agentName) activity")
    .navigationBarTitleDisplayMode(.inline)
    .task { await model.refreshAgentJobs() }
  }

  private var agentName: String {
    model.workspace?.agents.first { $0.id == agentID }?.name
      ?? WorkspaceAgentCatalog.agent(forID: agentID)?.name
      ?? agentID.capitalized
  }

  private var isWorking: Bool {
    model.workingAgentPresences(
      workspaceID: model.workspace?.id,
      conversationID: conversationID
    ).contains { $0.id == agentID }
  }

  private var liveRecords: [AgentActivityRecord] {
    model.activityRecords(
      workspaceID: model.workspace?.id,
      conversationID: conversationID,
      agentID: agentID
    )
  }

  private var failedJobs: [AgentJobRecord] {
    model.failedAgentJobs(
      workspaceID: model.workspace?.id,
      conversationID: conversationID,
      agentID: agentID
    )
  }

  private var durableMessages: [ConversationMessage] {
    guard let workspace = model.workspace else { return [] }
    let ids = conversationID == "mission-control"
      ? workspace.conversations.map(\.id)
      : [conversationID]
    return ids.flatMap { id in
      model.conversations.messages(workspaceID: workspace.id, conversationID: id)
    }.filter {
      $0.author.agentID == agentID && !activityComponents(in: $0).isEmpty
    }.sorted { $0.createdAt < $1.createdAt }
  }

  private func conversationName(_ id: String) -> String {
    model.workspace?.conversations.first { $0.id == id }?.name ?? id
  }

  private func activityComponents(in message: ConversationMessage) -> [MessageComponent] {
    message.components.filter {
      $0.kind == "thinking" || $0.kind == "tool" || $0.kind == "error"
    }
  }

  private func activityGroup(
    title: String,
    date: Date,
    components: [MessageComponent],
    active: Bool,
    onRetry: (() -> Void)? = nil
  ) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Text(title).font(.system(size: 13, weight: .medium)).lineLimit(1)
        Spacer(minLength: 8)
        Text(date, style: .time)
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 11)

      Divider().overlay(ChiefTheme.line)

      if components.isEmpty {
        Text(active
          ? "The run is active. Tool calls will appear here as they start."
          : "Run completed without recorded tool calls.")
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .padding(12)
      } else {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(components.enumerated()), id: \.element.id) { index, component in
            if component.kind == "thinking" {
              ThinkingMessageComponent(component: component)
            } else if component.kind == "error" {
              AgentRunErrorComponent(
                component: component,
                onRetry: onRetry ?? (canRetryOnboarding ? {
                  Task { await model.completeOnboarding() }
                } : nil)
              )
            } else {
              ToolMessageComponent(component: component)
            }
            if index < components.count - 1 {
              Divider().overlay(ChiefTheme.line.opacity(0.7))
            }
          }
        }
      }
    }
    .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 13))
    .overlay {
      RoundedRectangle(cornerRadius: 13)
        .stroke(ChiefTheme.line, lineWidth: 0.5)
    }
  }

  private func failureComponent(for job: AgentJobRecord) -> MessageComponent {
    MessageComponent(
      id: "job-error-\(job.id)",
      kind: "error",
      payload: [
        "code": "agent_job_failed",
        "title": job.payload.title ?? "Run interrupted",
        "message": job.lastError ?? "This agent couldn't complete its run.",
        "retryable": "true",
      ]
    )
  }

  private var canRetryOnboarding: Bool {
    agentID == "chief" && model.workspace?.onboardingComplete == false
  }
}
