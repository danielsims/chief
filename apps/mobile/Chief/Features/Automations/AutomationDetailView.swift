import SwiftUI

/// An automation, read the way desktop's builder lays it out: the trigger and
/// its steps as one top-to-bottom flow marked with the latest run, then the
/// run history and settings.
struct AutomationDetailView: View {
  @Environment(AppModel.self) private var model
  @State var schedule: WorkspaceSchedule
  let onUpdate: (WorkspaceSchedule) -> Void
  @State private var runs: [WorkspaceScheduleRun]?
  @State private var reload = 0
  @State private var isUpdating = false
  @State private var error: String?
  @State private var openRun: WorkspaceScheduleRun?
  @State private var selection: AutomationFlowSelection?

  /// The run the flow shows: the most recent one, test or not.
  private var latest: WorkspaceScheduleRun? { runs?.first }

  var body: some View {
    VStack(spacing: 0) {
      PageDetailBar(title: schedule.title)
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          VStack(alignment: .leading, spacing: 8) {
            header
            if schedule.status == "active" || schedule.status == "paused" {
              controls
            } else if schedule.status == "needs_approval" || schedule.status == "draft" {
              SettingsNote(text: "Test it and turn it on from Chief on your computer.")
            }
          }
          flow
          history
          settings
        }
        .padding(ChiefTheme.pagePadding)
        .padding(.bottom, 28)
      }
      .refreshable { reload += 1 }
    }
    .background(ChiefTheme.background.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .background(InteractivePopEnabler())
    .sheet(item: $openRun) { run in
      ScheduledRunDetailView(reference: ScheduledRunReference(run: run, title: schedule.title))
    }
    .sheet(item: $selection) { selection in
      AutomationStepSheet(selection: selection, schedule: schedule, run: latest)
    }
    .task(id: model.workspace?.id) {
      guard let workspaceID = model.workspace?.id else { return }
      await AutomationCatalogue.shared.load(workspaceID: workspaceID, relay: model.relay)
    }
    .task(id: "\(model.workspace?.id ?? ""):\(reload)") { await followRuns() }
  }

  // MARK: Header

  private var header: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        AutomationStatusLabel(status: schedule.status)
        Text("·").foregroundStyle(ChiefTheme.tertiary)
        Text(schedule.timing)
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(1)
      }
      .font(.system(size: 13))
      HStack(spacing: 8) {
        AutomationInvolvedStack(
          lead: schedule.agentId, collaborators: schedule.collaborators, steps: schedule.steps)
        Text(schedule.agentIDs.map(name).joined(separator: ", "))
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(2)
      }
    }
  }

  private var controls: some View {
    VStack(alignment: .leading, spacing: 0) {
      SettingsToggle(title: "On", isOn: schedule.status == "active") {
        perform(schedule.status == "active" ? "pause" : "resume")
      }
      .disabled(isUpdating)
      if schedule.status == "active" {
        SettingsActionRow(title: "Run now", icon: "play", isWorking: isUpdating) { perform("run") }
      }
      if let error { SettingsNote(text: error, tone: .failure) }
    }
  }

  // MARK: Flow

  private var flow: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Text("Steps")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(ChiefTheme.secondary)
          .accessibilityAddTraits(.isHeader)
        Spacer(minLength: 8)
        if let latest { AutomationLatestRunLabel(run: latest, name: name) }
      }
      AutomationFlowCanvas(
        schedule: schedule,
        nodes: latest?.automation?.nodes ?? [:],
        triggered: latest.map { $0.state != "queued" } ?? false,
        name: name
      ) { selection = $0 }
    }
  }

  // MARK: Runs

  private var history: some View {
    SettingsSection(title: "Runs") {
      if let runs {
        if runs.isEmpty { SettingsNote(text: "No runs yet.") }
        ForEach(runs.prefix(20)) { run in
          Button {
            Haptics.light()
            openRun = run
          } label: {
            AutomationRunRow(run: run)
          }
          .buttonStyle(.plain)
        }
      } else {
        ChiefSpinner().frame(maxWidth: .infinity).padding(.top, 12)
      }
    }
  }

  // MARK: Settings

  private var settings: some View {
    SettingsSection(title: "Settings") {
      if !schedule.instructions.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text("Brief").font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
          Text(schedule.instructions)
            .font(.system(size: 15))
            .lineLimit(6)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { SettingsHairline() }
        .contentShape(Rectangle())
        .onTapGesture { selection = .brief }
      }
      SettingsValueRow(title: "Lead", value: name(schedule.agentId))
      if let channel = model.workspace?.conversations.first(where: { $0.id == schedule.conversationId }) {
        SettingsValueRow(title: "Channel", value: "#\(channel.name)")
      }
      SettingsValueRow(title: "Time limit", value: "\(schedule.maxDurationMinutes) min")
      if schedule.triggerMode != "webhook" {
        SettingsValueRow(
          title: "Timezone", value: schedule.timezone.replacingOccurrences(of: "_", with: " "))
      }
    }
  }

  private func name(_ id: String) -> String {
    model.workspace?.agentDisplayName(id) ?? id.capitalized
  }

  /// Polls while a run is going and, for a live automation, slowly otherwise
  /// so a scheduled run shows up on the flow as it starts.
  private func followRuns() async {
    repeat {
      guard let workspaceID = model.workspace?.id,
        let fetched = try? await model.relay.scheduleRuns(
          workspaceID: workspaceID, scheduleID: schedule.id),
        !Task.isCancelled
      else { return }
      runs = fetched.sorted { ($0.createdAt ?? $0.scheduledAt) > ($1.createdAt ?? $1.scheduledAt) }
      let active = fetched.contains(where: \.isActive)
      guard active || schedule.status == "active" else { return }
      do { try await Task.sleep(for: .seconds(active ? 3 : 15)) } catch { return }
    } while !Task.isCancelled
  }

  private func perform(_ action: String) {
    guard !isUpdating, let workspaceID = model.workspace?.id else { return }
    isUpdating = true
    error = nil
    Task {
      defer { isUpdating = false }
      do {
        let updated = try await model.relay.scheduleAction(
          workspaceID: workspaceID, scheduleID: schedule.id, action: action,
          commandID: UUID().uuidString)
        guard model.workspace?.id == workspaceID else { return }
        schedule = updated
        onUpdate(updated)
        if action == "run" { reload += 1 }
        Haptics.success()
      } catch {
        self.error =
          "Couldn’t update this automation. Check your connection and workspace permissions."
        Haptics.error()
      }
    }
  }
}

/// What the latest run is doing, as desktop's run card says it.
private struct AutomationLatestRunLabel: View {
  let run: WorkspaceScheduleRun
  let name: (String) -> String

  var body: some View {
    HStack(spacing: 6) {
      if let working {
        MatrixLoader(size: 11).foregroundStyle(ChiefTheme.secondary)
        Text(working)
      } else {
        Text(summary)
          .foregroundStyle(run.state == "failed" || run.state == "blocked" ? Color.red : ChiefTheme.secondary)
      }
    }
    .font(.system(size: 12))
    .foregroundStyle(ChiefTheme.secondary)
    .lineLimit(1)
  }

  /// Who or what the run is busy with right now.
  private var working: String? {
    guard run.state == "running" else { return nil }
    let agents = run.workingAgentIDs
    if !agents.isEmpty { return agents.map(name).joined(separator: ", ") + " working" }
    let step = (run.schedule.automation?.steps ?? []).walked.first {
      run.automation?.nodes[$0.id]?.state == "running"
    }
    return step?.title ?? "Running"
  }

  private var summary: String {
    let kind = run.isTest ? "Test" : "Last run"
    switch run.state {
    case "queued": return run.isTest ? "Test queued" : "Queued"
    case "completed": return run.isTest ? "Test passed" : "\(kind) done \(ago)"
    case "failed", "blocked": return "\(kind) failed \(ago)"
    case "cancelled": return "\(kind) stopped \(ago)"
    default: return run.state.capitalized
    }
  }

  private var ago: String {
    let at = Date(timeIntervalSince1970: (run.completedAt ?? run.scheduledAt) / 1000)
    return RelativeDateTimeFormatter.threadActivity.localizedString(for: at, relativeTo: .now)
  }
}

/// One run in the history: when, how it started, and how it went.
private struct AutomationRunRow: View {
  let run: WorkspaceScheduleRun

  var body: some View {
    SettingsRow {
      Group {
        if run.isActive {
          MatrixLoader(size: 13).foregroundStyle(ChiefTheme.secondary)
        } else {
          Circle().fill(dot).frame(width: 7, height: 7)
        }
      }
      .frame(width: 16)
      VStack(alignment: .leading, spacing: 3) {
        Text(
          Date(timeIntervalSince1970: run.scheduledAt / 1000)
            .formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day().hour().minute()))
        Text("\(source) · \(state)")
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
      }
      Spacer(minLength: 8)
      SettingsChevron()
    }
  }

  private var source: String {
    if run.isTest { return "Test run" }
    switch run.source {
    case "cron": return "Scheduled"
    case "webhook": return "Webhook"
    case "retry": return "Retry"
    default: return "Run now"
    }
  }

  private var state: String {
    switch run.state {
    case "completed": "Done"
    case "cancelled": "Stopped"
    default: run.state.capitalized
    }
  }

  private var dot: Color {
    switch run.state {
    case "completed": ChiefTheme.toggleOn
    case "failed", "blocked": .red
    default: ChiefTheme.tertiary
    }
  }
}
