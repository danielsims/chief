import Foundation

enum ScheduledRunDelivery {
  private struct Receipt: Decodable {
    let messageId: String
    let conversationId: String
    let threadRootId: String?
  }
  static func instruction(threadRootID: String) -> String {
    """
    This is a scheduled run in threadRootId \(threadRootID). Work in this thread and keep chat updates brief. For substantial output, use workspace_file_write to save a channel artifact, then relay_message_post with artifactIds containing its saved ID and threadRootId \(threadRootID). These are the native equivalents of files.write and channels.messages.post. Do not paste the full artifact into chat. Call missions_addRunCollaborator to explicitly queue extra teammates; a mention alone does not queue work. Use missions_reportRunStep for completion or a blocker. Once you have posted successfully, return a short completion acknowledgement; it will not be duplicated in chat.
    """
  }

  static func alreadyPublished(
    components: [MessageComponent], conversationID: String, threadRootID: String
  ) -> Bool {
    components.contains { component in
      guard component.kind == "tool", component.payload["name"] == RelayMessagePostTool.name,
        component.payload["status"] == "completed", let output = component.payload["output"],
        let data = output.data(using: .utf8),
        let message = try? JSONDecoder().decode(Receipt.self, from: data)
      else { return false }
      return !message.messageId.isEmpty && message.conversationId == conversationID
        && message.threadRootId == threadRootID
    }
  }
}
