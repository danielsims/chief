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

    func clear(workspaceID: String) { storage[workspaceID] = nil }
    func clearAll() { storage.removeAll() }

    private func deduplicated(_ messages: [ConversationMessage]) -> [ConversationMessage] {
        var ids = Set<String>()
        return messages
            .sorted { ($0.sequence, $0.createdAt) < ($1.sequence, $1.createdAt) }
            .filter { ids.insert($0.id).inserted }
    }
}
