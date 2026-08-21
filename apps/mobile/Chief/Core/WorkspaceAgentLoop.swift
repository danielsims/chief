import Foundation
import os

let agentLoopLog = Logger(subsystem: "sh.heychief.mobile", category: "agenty")

/// Keeps each on-phone agent cell attached to its own relay mailbox. Each
/// roster identity gets one socket and exactly one isolated cell. Jobs are
/// claimed only after a socket connection or availability event; there is no
/// polling and there are no fabricated completion messages.
actor WorkspaceAgentLoop {
  typealias WorkingCallback =
    @Sendable (
      _ agentID: String,
      _ conversationID: String,
      _ isWorking: Bool
    ) async -> Void
  typealias CompletionCallback = @Sendable () async -> Void

  private let relay: any RelayServing
  private let workspaceID: String
  private let roster: [String]
  private let configuration: AppConfiguration
  private let onWorking: WorkingCallback
  private let onActivity: AgentActivityCallback
  private let onCompletion: CompletionCallback
  private var logSink: RelayLogSink?
  private var drainingAgents: Set<String> = []

  init(
    relay: any RelayServing,
    workspaceID: String,
    roster: [String],
    configuration: AppConfiguration = .current(),
    onWorking: @escaping WorkingCallback,
    onActivity: @escaping AgentActivityCallback,
    onCompletion: @escaping CompletionCallback
  ) {
    self.relay = relay
    self.workspaceID = workspaceID
    self.roster = roster
    self.configuration = configuration
    self.onWorking = onWorking
    self.onActivity = onActivity
    self.onCompletion = onCompletion
  }

  func run() async {
    logSink = RelayLogSink(relay: relay, workspaceID: workspaceID)
    agentLoopLog.info("agent loop started for \(self.workspaceID)")
    recordLog(type: "info", operation: "agent.loop.start", message: "Agent loop started")
    await withTaskGroup(of: Void.self) { group in
      for agentID in roster {
        group.addTask { [weak self] in await self?.listen(agentID: agentID) }
      }
      await group.waitForAll()
    }
    agentLoopLog.info("agent loop stopped for \(self.workspaceID)")
  }

  private func listen(agentID: String) async {
    var reconnectDelay = 1.0
    while !Task.isCancelled {
      do {
        let live = RelayLiveClient(configuration: configuration)
        try await live.listenAgentMailbox(
          workspaceID: workspaceID,
          agentID: agentID,
          onConnected: { [weak self] in
            await self?.drainMailbox(agentID: agentID)
          },
          onJobAvailable: { [weak self] in
            await self?.drainMailbox(agentID: agentID)
          }
        )
        reconnectDelay = 1
      } catch is CancellationError {
        break
      } catch {
        agentLoopLog.warning(
          "agent mailbox disconnected for \(agentID): \(error.localizedDescription)"
        )
        do { try await Task.sleep(for: .seconds(reconnectDelay)) } catch { break }
        reconnectDelay = min(reconnectDelay * 2, 30)
      }
    }
  }

  private func drainMailbox(agentID: String) async {
    guard !drainingAgents.contains(agentID) else { return }
    drainingAgents.insert(agentID)
    defer { drainingAgents.remove(agentID) }
    do {
      while !Task.isCancelled,
        let lease = try await relay.claimAgentJob(
          workspaceID: workspaceID,
          agentID: agentID
        )
      {
        await runJob(agentID: agentID, lease: lease)
      }
    } catch {
      agentLoopLog.warning(
        "agent mailbox catch-up failed for \(agentID): \(error.localizedDescription)"
      )
    }
  }

  private func runJob(agentID: String, lease: AgentJobLease) async {
    let conversationID = lease.job.payload.conversationId ?? "mission-control"
    guard lease.job.agentId == agentID else {
      agentLoopLog.error("mailbox returned a job for another agent")
      return
    }
    guard
      let instruction = lease.job.payload.instruction?.trimmingCharacters(
        in: .whitespacesAndNewlines
      ), !instruction.isEmpty
    else {
      agentLoopLog.error("job \(lease.job.id) has no executable instruction")
      return
    }

    await onWorking(agentID, conversationID, true)
    defer { Task { await onWorking(agentID, conversationID, false) } }
    print("[Chief] agent \(agentID) started \(lease.job.kind)")
    do {
      let scope = try ChiefCellRuntime.scope(workspaceID: workspaceID, agentID: agentID)
      let context = [
        lease.job.payload.name.map { "Workspace: \($0)" },
        lease.job.payload.website.flatMap { $0.isEmpty ? nil : "Website: \($0)" },
        lease.job.payload.selectedApps.flatMap {
          $0.isEmpty ? nil : "Selected apps (relevance only): \($0.joined(separator: ", "))"
        },
        lease.job.payload.threadRootId.map {
          "Mission Control kickoff threadRootId: \($0)"
        },
        lease.job.payload.skillId.map {
          "Apply this attached skill: [chief-skill:\($0)]"
        },
      ].compactMap { $0 }.joined(separator: "\n")
      let turn = try await completeJobTurn(
        scope: scope,
        conversationID: conversationID,
        instruction: context.isEmpty ? instruction : "\(context)\n\n\(instruction)",
        jobKind: lease.job.kind,
        expectedThreadRootID: lease.job.payload.threadRootId
      )
      try await relay.completeAgentJob(
        workspaceID: workspaceID,
        agentID: agentID,
        leaseToken: lease.leaseToken,
        completion: AgentJobCompletion(
          publishedMessage: AgentPublishedMessage(
            conversationId: conversationID,
            body: turn.reply,
            components: turn.components
          )
        )
      )
      await onCompletion()
      agentLoopLog.info("completed \(lease.job.kind) for \(agentID)")
      recordLog(
        type: "info",
        operation: "agent.job.complete",
        agentId: agentID,
        message: "Completed \(lease.job.kind)"
      )
    } catch {
      let failure = AgentRunFailure(error)
      await onActivity(
        workspaceID,
        conversationID,
        agentID,
        failure.component()
      )
      // Publish nothing. Explicitly return the durable lease to the pending
      // queue so its alarm can wake the agent after a short backoff.
      try? await relay.failAgentJob(
        workspaceID: workspaceID,
        agentID: agentID,
        leaseToken: lease.leaseToken,
        error: failure.message,
        retryAt: AgentRetryPolicy.retryDate(
          attempt: lease.job.attempt,
          error: error
        )
      )
      await onCompletion()
      agentLoopLog.error(
        "failed \(lease.job.kind) for \(agentID): \(error.localizedDescription)"
      )
      print(
        "[Chief] agent \(agentID) failed \(lease.job.kind): \(error.localizedDescription)"
      )
      recordLog(
        type: "error",
        operation: "agent.job.execute",
        agentId: agentID,
        message: "Failed \(lease.job.kind): \(error.localizedDescription)"
      )
    }
  }

  private func completeJobTurn(
    scope: String,
    conversationID: String,
    instruction: String,
    jobKind: String,
    expectedThreadRootID: String?
  ) async throws -> TurnExtractor.Turn {
    var nextInstruction = instruction
    for attempt in 0..<3 {
      let result = try await ChiefCellRuntime.shared.runTurn(
        scope: scope,
        conversationID: conversationID,
        userText: nextInstruction
      )
      let turn = try TurnExtractor.extract(from: result)
      do {
        try KickoffToolEvidence.validate(
          components: turn.evidenceComponents,
          jobKind: jobKind,
          expectedThreadRootID: expectedThreadRootID
        )
        return turn
      } catch WorkspaceSetupError.missingRequiredToolCalls where attempt < 2 {
        nextInstruction = """
          Continue this same assignment. Your preceding turn stopped before every required relay action was complete. Inspect the existing tool results and relay state, then make only the remaining calls from the original instruction now. Do not repeat completed work or narrate compliance. Return the useful channel message only after the full original outcome exists.
          """
      }
    }
    throw WorkspaceSetupError.missingRequiredToolCalls
  }

  private func recordLog(
    type: String,
    operation: String,
    agentId: String? = nil,
    message: String
  ) {
    logSink?.record(
      RelayLogEntry.make(
        type: type,
        operation: operation,
        agentId: agentId,
        message: message
      )
    )
  }
}
