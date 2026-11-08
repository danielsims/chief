import Foundation

struct ScheduledRunReference: Equatable, Sendable {
  let runID: String
  let scheduleID: String
  let title: String
  let agentIDs: [String]

  init?(message: ConversationMessage) {
    guard case .system = message.author,
      let component = message.components.first(where: { $0.kind == "schedule.run" }),
      let runID = component.payload["runId"], !runID.isEmpty,
      let scheduleID = component.payload["scheduleId"], !scheduleID.isEmpty,
      let title = component.payload["title"], !title.isEmpty
    else { return nil }
    self.runID = runID
    self.scheduleID = scheduleID
    self.title = title
    self.agentIDs = component.payloadArrays["agentIds"] ?? []
  }

  init(run: WorkspaceScheduleRun, title: String) {
    self.runID = run.id
    self.scheduleID = run.scheduleId
    self.title = title
    self.agentIDs = run.agentIDs
  }
}

struct WorkspaceSchedule: Decodable, Equatable, Identifiable, Sendable {
  let id: String
  let title: String
  let status: String
  let agentId: String
  let collaborators: [String]
  let triggerMode: String
  let cron: String
  let timezone: String
  let onceAt: Double?
  let updatedAt: Double
  var conversationId = ""
  var instructions = ""
  var maxDurationMinutes = 60
  /// The steps it runs; without them the team works from the brief.
  var automation: WorkspaceAutomation?
  var nextAt: Double?
  var lastCompletedAt: Double?
  var upcomingRuns: [Double]?
  var recordedRuns: [Double]?

  var agentIDs: [String] { [agentId] + collaborators }
  var steps: [AutomationStep] { automation?.steps ?? [] }

  /// Every run time the relay knows of, past and upcoming, oldest first.
  var occurrences: [Double] {
    Set((recordedRuns ?? []) + (upcomingRuns ?? [])).sorted()
  }

  /// When it runs, in the words desktop's automation list uses.
  var timing: String {
    if triggerMode == "webhook" { return "On webhook delivery" }
    if let onceAt {
      var style = Date.FormatStyle.dateTime.weekday().month().day().hour().minute()
      style.timeZone = TimeZone(identifier: timezone) ?? .current
      return Date(timeIntervalSince1970: onceAt / 1000).formatted(style)
    }
    let fields = cron.split(separator: " ").map(String.init)
    guard fields.count == 5, fields[3] == "*", let minute = Int(fields[0]), let hour = Int(fields[1]),
      let date = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: .now)
    else { return "Custom schedule" }
    let time = date.formatted(date: .omitted, time: .shortened)
    switch (fields[2], fields[4]) {
    case ("*", "*"): return "Every day at \(time)"
    case ("*", "1-5"): return "Weekdays at \(time)"
    case ("*", let day):
      guard let weekday = Int(day), (0...6).contains(weekday) else { return "Custom schedule" }
      return "Every \(Calendar.current.weekdaySymbols[weekday]) at \(time)"
    case (let day, "*") where Int(day) != nil: return "Monthly on day \(day) at \(time)"
    default: return "Custom schedule"
    }
  }
}

struct WorkspaceScheduleList: Decodable { let schedules: [WorkspaceSchedule] }

struct WorkspaceScheduleRun: Codable, Equatable, Identifiable, Sendable {
  /// The automation as it was when this run started.
  struct Team: Codable, Equatable, Sendable {
    let agentId: String
    let collaborators: [String]
    let conversationId: String
    var automation: WorkspaceAutomation?
  }
  struct Step: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let agentId: String
    let phase: String
    let state: String
    let assignment: String?
    let evidence: String?
    let error: String?
  }
  let id: String
  let scheduleId: String
  let threadRootId: String
  let state: String
  let schedule: Team
  let steps: [Step]
  let summary: String?
  let scheduledAt: Double
  var source = "manual"
  var test: Bool?
  /// What each automation step did, by step id.
  var automation: AutomationRunState?
  var startedAt: Double?
  var completedAt: Double?
  var createdAt: Double?

  var isActive: Bool { state == "queued" || state == "running" }
  var isTest: Bool { test == true }
  var agentIDs: [String] {
    var seen = Set<String>()
    return ([schedule.agentId] + schedule.collaborators).filter { seen.insert($0).inserted }
  }
  var workingAgentIDs: [String] {
    guard state == "running" else { return [] }
    var seen = Set<String>()
    return steps.filter { $0.state == "running" }.map(\.agentId).filter { seen.insert($0).inserted }
  }
}

struct WorkspaceScheduleRunList: Decodable { let runs: [WorkspaceScheduleRun] }

extension WorkspaceSnapshot {
  func agentDisplayName(_ id: String) -> String? {
    agents.compactMap { $0.profile(id: id)?.name }.first
      ?? WorkspaceAgentCatalog.agent(forID: id)?.name
  }
}
