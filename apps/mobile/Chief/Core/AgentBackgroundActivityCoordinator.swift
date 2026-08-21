import ActivityKit
import BackgroundTasks
import Foundation
import OSLog
import UIKit
import UserNotifications

/// Owns the system execution lease and privacy-safe surfaces for an in-flight
/// agent-cell turn. The cell checkpoint and relay job remain authoritative;
/// this coordinator only keeps user-initiated work eligible to continue while
/// Chief is backgrounded and makes its progress visible to the user.
@MainActor
final class AgentBackgroundActivityCoordinator {
  static let shared = AgentBackgroundActivityCoordinator()

  enum Outcome {
    case completed
    case paused
  }

  private let logger = Logger(
    subsystem: "sh.heychief.mobile",
    category: "AgentBackgroundActivity"
  )
  private let taskIdentifierPrefix = "sh.heychief.mobile.agent"
  private var activeScopes: Set<String> = []
  private var activities: [String: LiveActivityHandle] = [:]
  private var continuedTasks: [String: BGContinuedProcessingTask] = [:]
  private var continuedTaskIdentifiers: [String: String] = [:]
  private var bridgeTasks: [String: UIBackgroundTaskIdentifier] = [:]
  private var actionCounts: [String: Int] = [:]
  private var lastProgressReports: [String: Date] = [:]
  private var metadata: [String: Metadata] = [:]
  private var applicationIsActive = true

  private struct Metadata {
    let workspaceID: String
    let conversationID: String
    let agentName: String
  }

  /// ActivityKit's handle is internally thread-safe but is not annotated as
  /// `Sendable` in the iOS 26 SDK. Keep the unchecked boundary tiny and expose
  /// only the two async operations Chief needs instead of weakening strict
  /// concurrency for the whole target.
  private final class LiveActivityHandle: @unchecked Sendable {
    let value: Activity<ChiefAgentActivityAttributes>

    init(_ value: Activity<ChiefAgentActivityAttributes>) {
      self.value = value
    }

    func update(
      _ content: ActivityContent<ChiefAgentActivityAttributes.ContentState>
    ) async {
      await value.update(content)
    }

    func end(
      _ content: ActivityContent<ChiefAgentActivityAttributes.ContentState>,
      dismissalPolicy: ActivityUIDismissalPolicy
    ) async {
      await value.end(content, dismissalPolicy: dismissalPolicy)
    }
  }

  private init() {}

  func setApplicationActive(_ isActive: Bool) {
    applicationIsActive = isActive
  }

  func begin(
    scope: String,
    workspaceID: String,
    conversationID: String,
    agentName: String
  ) async {
    metadata[scope] = Metadata(
      workspaceID: workspaceID,
      conversationID: conversationID,
      agentName: agentName
    )
    guard activeScopes.insert(scope).inserted else {
      await update(scope: scope, phase: .thinking, status: "Thinking")
      return
    }
    actionCounts[scope] = 0
    lastProgressReports[scope] = nil
    beginBridgeTask(scope: scope)

    let identifier = taskIdentifier()
    continuedTaskIdentifiers[scope] = identifier
    let registered = BGTaskScheduler.shared.register(
      forTaskWithIdentifier: identifier,
      using: .main
    ) { [weak self] task in
      guard let task = task as? BGContinuedProcessingTask else {
        task.setTaskCompleted(success: false)
        return
      }
      Task { @MainActor in
        self?.attach(task, scope: scope, identifier: identifier)
      }
    }

    guard registered else {
      continuedTaskIdentifiers.removeValue(forKey: scope)
      record(scope: scope, event: "registration-rejected")
      await beginFallbackActivity(scope: scope)
      return
    }

    let request = BGContinuedProcessingTaskRequest(
      identifier: identifier,
      title: "\(agentName) is thinking",
      subtitle: ChiefAgentActivityAttributes.workInProgressSubtitle
    )
    request.strategy = .fail
    do {
      try BGTaskScheduler.shared.submit(request)
      record(scope: scope, event: "submitted")
      await waitForAttachment(scope: scope, identifier: identifier)
    } catch {
      continuedTaskIdentifiers.removeValue(forKey: scope)
      record(scope: scope, event: "submission-failed", detail: error.localizedDescription)
      await beginFallbackActivity(scope: scope)
    }
  }

  func modelStarted(scope: String) async {
    await update(scope: scope, phase: .thinking, status: "Thinking")
  }

  func modelProgressed(scope: String) {
    guard activeScopes.contains(scope) else { return }
    let now = Date()
    if let last = lastProgressReports[scope], now.timeIntervalSince(last) < 2 { return }
    lastProgressReports[scope] = now
    advanceProgress(scope: scope)
  }

  func toolStarted(scope: String, name: String) async {
    actionCounts[scope, default: 0] += 1
    await update(scope: scope, phase: .usingTool, status: Self.toolStatus(name))
  }

  func browserActionStarted(scope: String, label: String) async {
    guard activeScopes.contains(scope), let safe = Self.safeBrowserLabel(label) else { return }
    await update(
      scope: scope,
      phase: .usingTool,
      status: safe,
      detail: "Browser · \(actionCounts[scope] ?? 0) actions",
      advancesProgress: false
    )
  }

  func finish(scope: String, outcome: Outcome) async {
    guard activeScopes.remove(scope) != nil else { return }
    endBridgeTask(scope: scope)
    lastProgressReports.removeValue(forKey: scope)
    let count = actionCounts.removeValue(forKey: scope) ?? 0

    if let identifier = continuedTaskIdentifiers.removeValue(forKey: scope) {
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
    }
    if let task = continuedTasks.removeValue(forKey: scope) {
      switch outcome {
      case .completed:
        task.progress.completedUnitCount = task.progress.totalUnitCount
        task.updateTitle("Agent finished", subtitle: "Ready to review")
        task.setTaskCompleted(success: true)
      case .paused:
        task.updateTitle("Agent paused", subtitle: "Progress saved")
        task.setTaskCompleted(success: false)
      }
    }

    let phase: ChiefAgentActivityAttributes.ContentState.Phase
    let status: String
    switch outcome {
    case .completed:
      phase = .completed
      status = "Finished"
    case .paused:
      phase = .paused
      status = "Turn paused"
    }
    if let activity = activity(for: scope) {
      await activity.end(
        Self.content(.init(
          phase: phase,
          status: status,
          detail: count == 1 ? "1 action" : "\(count) actions",
          actionCount: count
        )),
        dismissalPolicy: .after(Date().addingTimeInterval(20))
      )
      activities.removeValue(forKey: scope)
    }

    record(scope: scope, event: phase == .completed ? "completed" : "paused")
    let details = metadata.removeValue(forKey: scope)
    guard !applicationIsActive, let details else { return }
    switch outcome {
    case .completed:
      // The completed turn publishes its final relay message, which owns the
      // user-facing notification and selected Chief sound. The Live Activity
      // ends above without emitting a duplicate system alert.
      break
    case .paused:
      await notify(
        metadata: details,
        title: "\(details.agentName) paused",
        body: "Progress is saved. Open the conversation to continue."
      )
    }
  }

  private func attach(
    _ task: BGContinuedProcessingTask,
    scope: String,
    identifier: String
  ) {
    guard activeScopes.contains(scope), continuedTaskIdentifiers[scope] == identifier else {
      task.setTaskCompleted(success: false)
      return
    }
    continuedTasks[scope] = task
    endBridgeTask(scope: scope)
    task.progress.totalUnitCount = 10_000
    task.progress.completedUnitCount = 1
    task.updateTitle("Thinking", subtitle: ChiefAgentActivityAttributes.workInProgressSubtitle)
    task.expirationHandler = { [weak self] in
      Task { @MainActor in self?.expire(scope: scope, task: task) }
    }
    record(scope: scope, event: "attached")
  }

  private func expire(scope: String, task: BGContinuedProcessingTask) {
    guard continuedTasks[scope] === task else { return }
    continuedTasks.removeValue(forKey: scope)
    if let identifier = continuedTaskIdentifiers.removeValue(forKey: scope) {
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
    }
    task.updateTitle("Agent paused", subtitle: "Progress saved")
    task.setTaskCompleted(success: false)
    record(scope: scope, event: "expired")
    // The cell checkpoint and relay lease are already persisted. If iOS now
    // suspends or terminates Chief, the same keyed cell resumes on next launch.
  }

  private func update(
    scope: String,
    phase: ChiefAgentActivityAttributes.ContentState.Phase,
    status: String,
    detail: String? = nil,
    advancesProgress: Bool = true
  ) async {
    if let task = continuedTasks[scope] {
      task.updateTitle(status, subtitle: ChiefAgentActivityAttributes.workInProgressSubtitle)
      if advancesProgress { advanceProgress(scope: scope) }
    }
    guard let activity = activity(for: scope) else { return }
    await activity.update(Self.content(.init(
      phase: phase,
      status: status,
      detail: detail ?? Self.activityDetail(phase: phase, count: actionCounts[scope] ?? 0),
      actionCount: actionCounts[scope] ?? 0
    )))
  }

  private func beginFallbackActivity(scope: String) async {
    guard let details = metadata[scope], ActivityAuthorizationInfo().areActivitiesEnabled else {
      return
    }
    let state = ChiefAgentActivityAttributes.ContentState(
      phase: .thinking,
      status: "Thinking",
      detail: "Starting agent turn",
      actionCount: 0
    )
    if let activity = activity(for: scope) {
      await activity.update(Self.content(state))
      return
    }
    do {
      activities[scope] = LiveActivityHandle(try Activity.request(
        attributes: ChiefAgentActivityAttributes(
          workspaceID: details.workspaceID,
          conversationID: details.conversationID,
          agentName: details.agentName,
          startedAt: Date()
        ),
        content: Self.content(state),
        pushType: nil
      ))
    } catch {
      logger.error("Live Activity failed: \(error.localizedDescription, privacy: .public)")
    }
  }

  private func activity(for scope: String) -> LiveActivityHandle? {
    if let cached = activities[scope] { return cached }
    guard let details = metadata[scope],
      let restored = Activity<ChiefAgentActivityAttributes>.activities.first(where: {
        $0.attributes.workspaceID == details.workspaceID
          && $0.attributes.conversationID == details.conversationID
          && $0.attributes.agentName == details.agentName
      })
    else { return nil }
    let handle = LiveActivityHandle(restored)
    activities[scope] = handle
    return handle
  }

  private func beginBridgeTask(scope: String) {
    guard bridgeTasks[scope] == nil else { return }
    var identifier = UIBackgroundTaskIdentifier.invalid
    identifier = UIApplication.shared.beginBackgroundTask(withName: "Agent turn") {
      Task { @MainActor [weak self] in
        self?.record(scope: scope, event: "bridge-expired")
        self?.endBridgeTask(scope: scope)
      }
    }
    if identifier != .invalid { bridgeTasks[scope] = identifier }
  }

  private func endBridgeTask(scope: String) {
    guard let identifier = bridgeTasks.removeValue(forKey: scope), identifier != .invalid else {
      return
    }
    UIApplication.shared.endBackgroundTask(identifier)
  }

  private func waitForAttachment(scope: String, identifier: String) async {
    let deadline = Date().addingTimeInterval(3)
    while Date() < deadline {
      if continuedTasks[scope] != nil || continuedTaskIdentifiers[scope] != identifier { return }
      try? await Task.sleep(for: .milliseconds(50))
    }
    if continuedTasks[scope] == nil, continuedTaskIdentifiers[scope] == identifier {
      record(scope: scope, event: "attachment-timeout")
    }
  }

  private func advanceProgress(scope: String) {
    guard let task = continuedTasks[scope] else { return }
    task.progress.completedUnitCount = min(
      max(1, task.progress.totalUnitCount - 1),
      max(1, task.progress.completedUnitCount + 1)
    )
  }

  private func notify(metadata: Metadata, title: String, body: String) async {
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    guard settings.authorizationStatus == .authorized
      || settings.authorizationStatus == .provisional
    else { return }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = MobileNotifications.configuredSound
    content.threadIdentifier = metadata.conversationID
    content.userInfo = [
      "workspaceID": metadata.workspaceID,
      "conversationID": metadata.conversationID,
    ]
    try? await UNUserNotificationCenter.current().add(UNNotificationRequest(
      identifier: "agent-turn-\(UUID().uuidString)",
      content: content,
      trigger: nil
    ))
  }

  private func taskIdentifier() -> String {
    "\(taskIdentifierPrefix).\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
  }

  private func record(scope: String, event: String, detail: String? = nil) {
    var record: [String: Any] = ["event": event, "at": Date().timeIntervalSince1970]
    if let detail { record["detail"] = String(detail.prefix(240)) }
    let key = "agent.background.lifecycle.\(scope)"
    var history = UserDefaults.standard.array(forKey: key) as? [[String: Any]] ?? []
    history.append(record)
    if history.count > 40 { history.removeFirst(history.count - 40) }
    UserDefaults.standard.set(history, forKey: key)
    logger.info("scope=\(scope, privacy: .public) event=\(event, privacy: .public)")
  }

  private static func content(
    _ state: ChiefAgentActivityAttributes.ContentState
  ) -> ActivityContent<ChiefAgentActivityAttributes.ContentState> {
    ActivityContent(state: state, staleDate: nil)
  }

  private static func toolStatus(_ name: String) -> String {
    switch name {
    case "browser_navigate": "Opening page"
    case "browser_snapshot": "Reading page"
    case "browser_click": "Clicking page"
    case "browser_type": "Entering text"
    case "browser_scroll": "Scrolling page"
    case "browser_back": "Going back"
    case "browser_release": "Finishing browsing"
    case let value where value.hasPrefix("browser_"): "Using browser"
    case let value where value.hasPrefix("relay_message"): "Posting an update"
    case let value where value.hasPrefix("relay_channel"): "Organising channels"
    case let value where value.hasSuffix("_save"): "Saving work"
    default: "Working"
    }
  }

  private static func activityDetail(
    phase: ChiefAgentActivityAttributes.ContentState.Phase,
    count: Int
  ) -> String {
    switch phase {
    case .thinking: count == 0 ? "Planning the next step" : "Choosing the next action"
    case .usingTool: count == 1 ? "1 action in progress" : "\(count) actions so far"
    case .completed: "Ready to review"
    case .paused: "Progress saved"
    }
  }

  private static func safeBrowserLabel(_ raw: String) -> String? {
    var value = raw.replacingOccurrences(
      of: "\\s+",
      with: " ",
      options: .regularExpression
    ).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }
    if value.localizedCaseInsensitiveContains("typing") {
      value = value.localizedCaseInsensitiveContains("password")
        ? "Entering sign-in details" : "Entering text"
    } else {
      value = value.replacingOccurrences(
        of: #"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#,
        with: "private field",
        options: [.regularExpression, .caseInsensitive]
      )
      value = value.replacingOccurrences(
        of: #"\b\d{6,}\b"#,
        with: "••••",
        options: .regularExpression
      )
    }
    return String(value.prefix(96))
  }

}
