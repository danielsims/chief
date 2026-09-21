import Foundation
import Observation

@MainActor
@Observable
final class ConversationCache {
    private var storage: [String: [String: [ConversationMessage]]] = [:]

    func messages(workspaceID: String, conversationID: String) -> [ConversationMessage] {
        storage[workspaceID]?[conversationID] ?? []
    }

    func replace(
        workspaceID: String,
        conversationID: String,
        messages: [ConversationMessage]
    ) {
        var workspace = storage[workspaceID] ?? [:]
        workspace[conversationID] = deduplicated(messages)
        storage[workspaceID] = workspace
    }

    func merge(_ message: ConversationMessage) {
        var current = messages(
            workspaceID: message.workspaceID,
            conversationID: message.conversationID
        )
        current.append(message)
        replace(
            workspaceID: message.workspaceID,
            conversationID: message.conversationID,
            messages: current
        )
    }

    /// Reconcile a history response without overwriting live changes made while
    /// the request was in flight. Build the collection once for large backlogs.
    func reconcileHistory(
        workspaceID: String,
        conversationID: String,
        messages: [ConversationMessage],
        baseline: [ConversationMessage]
    ) {
        let before = Dictionary(baseline.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var current = Dictionary(
            self.messages(workspaceID: workspaceID, conversationID: conversationID).map { ($0.id, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        for message in messages where message.workspaceID == workspaceID && message.conversationID == conversationID {
            if current[message.id] == nil || current[message.id] == before[message.id] {
                current[message.id] = message
            }
        }
        replace(workspaceID: workspaceID, conversationID: conversationID, messages: Array(current.values))
    }

    /// Fold an edit/reaction event into the cache. Cursor catch-up can deliver
    /// an update after its original append fell before the saved frontier, so
    /// a missing row must be inserted rather than discarded.
    func update(_ message: ConversationMessage) {
        var current = messages(
            workspaceID: message.workspaceID,
            conversationID: message.conversationID
        )
        if let index = current.firstIndex(where: { $0.id == message.id }) {
            current[index] = message
        } else {
            current.append(message)
        }
        replace(
            workspaceID: message.workspaceID,
            conversationID: message.conversationID,
            messages: current
        )
    }

    func clear(workspaceID: String) { storage[workspaceID] = nil }
    func clear(workspaceID: String, conversationID: String) {
        storage[workspaceID]?[conversationID] = nil
        if storage[workspaceID]?.isEmpty == true { storage[workspaceID] = nil }
    }
    func clearAll() { storage.removeAll() }

    private func deduplicated(_ messages: [ConversationMessage]) -> [ConversationMessage] {
        var ids = Set<String>()
        return messages
            .sorted { ($0.sequence, $0.createdAt) < ($1.sequence, $1.createdAt) }
            .filter { ids.insert($0.id).inserted }
    }
}
