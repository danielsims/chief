import Foundation

extension AppModel {
  func acknowledgeActivityErrors(conversationID: String) {
    guard let userID = session?.user.id, let workspaceID = workspace?.id else { return }
    activityErrorAcknowledgements.acknowledge(
      userID: userID, workspaceID: workspaceID, conversationID: conversationID
    )
  }

  func activityErrorCount(workspaceID: String?, conversationID: String) -> Int {
    guard let workspaceID, workspace?.id == workspaceID, let userID = session?.user.id else { return 0 }
    let jobs = agentJobsByAgentID.values.flatMap { $0 }.filter {
      $0.workspaceId == workspaceID && (conversationID == "mission-control" || $0.payload.conversationId == conversationID)
    }
    let latestJobs = Dictionary(grouping: jobs, by: \.agentId).compactMapValues {
      $0.max { $0.updatedDate < $1.updatedDate }
    }
    let latestRecords = Dictionary(
      grouping: activityRecords(workspaceID: workspaceID, conversationID: conversationID), by: \.agentID
    ).compactMapValues { $0.first }
    let working = Set(workingAgentPresences(workspaceID: workspaceID, conversationID: conversationID).map(\.id))
    let ids = Set(latestJobs.keys).union(latestRecords.keys).subtracting(working)
    return ids.filter { agentID in
      let job = latestJobs[agentID]
      let record = latestRecords[agentID]
      let failureDate: Date
      let scope: String
      let turnStarted: Date
      if let job, job.status == "failed", job.updatedDate >= (record?.updatedAt ?? .distantPast) {
        failureDate = job.updatedDate
        turnStarted = job.updatedDate
        scope = job.payload.conversationId ?? conversationID
      } else if let record, !record.isWorking, record.components.contains(where: { $0.kind == "error" }) {
        failureDate = record.updatedAt
        turnStarted = record.startedAt
        scope = record.conversationID
        if let job, job.status == "completed", job.updatedDate >= turnStarted { return false }
      } else {
        return false
      }
      if activityErrorAcknowledgements.contains(failureDate, userID: userID, workspaceID: workspaceID, conversationID: scope) { return false }
      let recovered = conversations.messages(workspaceID: workspaceID, conversationID: scope).contains {
        $0.author.agentID == agentID && $0.createdAt >= turnStarted
          && !$0.body.isEmpty && !$0.components.contains(where: { $0.kind == "error" })
      }
      return !recovered
    }.count
  }
}
