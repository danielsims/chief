import SwiftUI

struct ConversationActivityFooter: View {
  @Environment(AppModel.self) private var model
  @Environment(\.scheduledRuns) private var scheduledRuns
  let agents: [AgentActivityPresence]
  var scheduledThreadRootID: String? = nil
  let errorCount: Int
  let openActivity: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      if !visibleAgents.isEmpty {
        AgentTypingRow(agents: visibleAgents, openActivity: openActivity)
          .transition(.opacity)
      }
      if errorCount > 0 {
        AgentActivityErrorStatus(count: errorCount, openActivity: openActivity)
      }
    }
    .animation(.easeOut(duration: 0.2), value: visibleAgents)
  }
  private var visibleAgents: [AgentActivityPresence] {
    let scheduled = WorkspaceScheduleRun.workingPresences(Array(scheduledRuns.values), threadRootID: scheduledThreadRootID) { id in
      model.workspace?.agentDisplayName(id) ?? WorkspaceAgentCatalog.agent(forID: id)?.name ?? id.capitalized
    }
    var seen = Set<String>()
    return (agents + scheduled).filter { seen.insert($0.id).inserted }
  }
}

struct AgentTypingRow: View {
  let agents: [AgentActivityPresence]
  let openActivity: () -> Void

  var body: some View {
    Button {
      Haptics.medium()
      openActivity()
    } label: {
      HStack(spacing: 10) {
        HStack(spacing: 6) {
          ForEach(agents.prefix(3)) { agent in
            MatrixLoader(size: 15)
              .foregroundStyle(ChiefTheme.agentColor(agent.id))
              .frame(width: 23, height: 23)
          }
        }
        Text(statusText)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(1)
        Spacer(minLength: 0)
        Text("Activity")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(ChiefTheme.tertiary)
        Image(systemName: "chevron.right")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.vertical, 7)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityElement(children: .combine)
  }

  private var statusText: String {
    let names = agents.map(\.name)
    return switch names.count {
    case 0: "The team is working…"
    case 1: "\(names[0]) is working…"
    case 2: "\(names[0]) and \(names[1]) are working…"
    case 3: "\(names[0]), \(names[1]), and \(names[2]) are working…"
    default: "\(names[0]), \(names[1]), and \(names.count - 2) others are working…"
    }
  }
}

private struct AgentActivityErrorStatus: View {
  let count: Int
  let openActivity: () -> Void

  var body: some View {
    Button {
      Haptics.medium()
      openActivity()
    } label: {
      HStack(spacing: 8) {
        Image(systemName: "exclamationmark.circle")
          .foregroundStyle(.red)
        Text("\(count) \(count == 1 ? "error" : "errors")")
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(.red)
        Spacer(minLength: 4)
        Text("Activity")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(ChiefTheme.tertiary)
        Image(systemName: "chevron.right")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.vertical, 8)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(count) agent \(count == 1 ? "error" : "errors"). Open activity.")
  }
}

struct ConversationLoadingView: View {
  var body: some View {
    VStack(spacing: 12) {
      ProgressView().controlSize(.regular)
      Text("Loading conversation…")
        .font(.system(size: 14))
        .foregroundStyle(ChiefTheme.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityElement(children: .combine)
  }
}

struct ConversationLoadFailureView: View {
  let onRetry: () -> Void

  var body: some View {
    VStack(spacing: 14) {
      Image(systemName: "wifi.exclamationmark")
        .font(.system(size: 34, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
      VStack(spacing: 5) {
        Text("We couldn't load this conversation")
          .font(.system(size: 18, weight: .semibold, design: .rounded))
          .foregroundStyle(ChiefTheme.accent)
        Text(
          "Chief is having trouble reaching the workspace right now. Your messages are safe — try again in a moment."
        )
        .font(.system(size: 14))
        .foregroundStyle(ChiefTheme.secondary)
        .multilineTextAlignment(.center)
        .lineSpacing(2)
      }
      .frame(maxWidth: 300)
      Button("Try again", action: onRetry)
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(.black)
        .frame(maxWidth: 240)
        .frame(height: 46)
        .background(.white, in: RoundedRectangle(cornerRadius: 13))
        .buttonStyle(.plain)
        .padding(.top, 6)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(.horizontal, ChiefTheme.pagePadding)
    .accessibilityElement(children: .combine)
  }
}

struct ConversationEmptyView: View {
  var body: some View {
    VStack(spacing: 8) {
      Text("What should we work on?")
        .font(.system(size: 22, weight: .semibold, design: .rounded))
        .foregroundStyle(ChiefTheme.accent)
      Text("Share a task or let Chief get oriented in this workspace.")
        .font(.system(size: 14))
        .foregroundStyle(ChiefTheme.secondary)
        .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(.horizontal, ChiefTheme.pagePadding)
  }
}
