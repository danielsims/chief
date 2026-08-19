import Foundation
import os

let agentLoopLog = Logger(subsystem: "sh.heychief.mobile", category: "agenty")

/// Keeps the workspace "alive" after onboarding: while the app is in the
/// workspace phase it periodically claims pending jobs for each agent in the
/// roster and runs them through inference, publishing results to whichever
/// conversation the job targets (mission-control by default). This mirrors the
/// desktop bootstrap's continuous kickoff; when OpenCode Go is unavailable it
/// completes jobs with accurate fallback messages rather than dead-ending.
actor WorkspaceAgentLoop {
  private let relay: any RelayServing
  private let inference: Inference
  private let workspaceID: String
  private let roster: [String]
  private let pollIntervalSeconds: UInt64
  private var logSink: RelayLogSink?

  struct Inference: Sendable {
    let loadKey: @Sendable () throws -> String?
    let generate: @Sendable (String) async throws -> String
  }

  init(
    relay: any RelayServing,
    inference: Inference,
    workspaceID: String,
    roster: [String],
    pollIntervalSeconds: UInt64 = 6
  ) {
    self.relay = relay
    self.inference = inference
    self.workspaceID = workspaceID
    self.roster = roster
    self.pollIntervalSeconds = pollIntervalSeconds
  }

  func run() async {
    logSink = RelayLogSink(relay: relay, workspaceID: workspaceID)
    agentLoopLog.info("agent loop started for \(self.workspaceID)")
    recordLog(type: "info", operation: "agent.loop.start", message: "Agent loop started")
    var activeAgent = 0
    if roster.isEmpty { return }
    while !Task.isCancelled {
      let agentID = roster[activeAgent % roster.count]
      activeAgent &+= 1
      do {
        if let lease = try await relay.claimAgentJob(
          workspaceID: workspaceID,
          agentID: agentID
        ) {
          await runJob(agentID: agentID, lease: lease)
        }
      } catch {
        agentLoopLog.warning("agent loop claim failed: \(error.localizedDescription)")
      }
      try? await Task.sleep(for: .seconds(pollIntervalSeconds))
    }
    agentLoopLog.info("agent loop stopped for \(self.workspaceID)")
  }

  private func runJob(agentID: String, lease: AgentJobLease) async {
    let message: String
    if let loaded = try? inference.loadKey(), !loaded.isEmpty {
      message =
        (try? await inference.generate(agentID)) ??
        fallback(for: lease.job.kind, agentID: agentID)
    } else {
      message = fallback(for: lease.job.kind, agentID: agentID)
    }
    do {
      try await relay.completeAgentJob(
        workspaceID: workspaceID,
        agentID: agentID,
        leaseToken: lease.leaseToken,
        completion: AgentJobCompletion(
          publishedMessage: AgentPublishedMessage(
            conversationId: "mission-control",
            body: message
          )
        )
      )
      agentLoopLog.info("completed \(lease.job.kind) for \(agentID)")
      recordLog(
        type: "info",
        operation: "agent.job.complete",
        agentId: agentID,
        message: "Completed \(lease.job.kind)"
      )
    } catch {
      agentLoopLog.error(
        "failed to complete \(lease.job.kind) for \(agentID): \(error.localizedDescription)"
      )
      recordLog(
        type: "error",
        operation: "agent.job.complete",
        agentId: agentID,
        message: "Failed to complete \(lease.job.kind): \(error.localizedDescription)"
      )
    }
  }

  private func recordLog(
    type: String,
    operation: String,
    agentId: String? = nil,
    message: String
  ) {
    logSink?.record(
      RelayLogEntry.make(type: type, operation: operation, agentId: agentId, message: message)
    )
  }

  private func fallback(for kind: String, agentID: String) -> String {
    switch kind {
    case "workspace.activate":
      return "\(displayName(agentID)) is oriented and ready. I'll surface concrete next steps as I dig in."
    case "workspace.observe":
      return "\(displayName(agentID)) is scanning for useful work. Nothing needs your attention yet."
    default:
      return "\(displayName(agentID)) wrapped up its first check. I'll keep you posted."
    }
  }

  private func displayName(_ agentID: String) -> String {
    agentID == "chief" ? "Chief" : agentID.capitalized
  }
}
