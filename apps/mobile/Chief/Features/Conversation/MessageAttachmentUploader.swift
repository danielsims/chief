import Foundation
import UniformTypeIdentifiers

enum MessageAttachmentUploader {
  static func components(
    for attachments: [ComposerAttachment],
    workspaceID: String,
    conversationID: String,
    relay: any RelayServing
  ) async throws -> [MessageComponent] {
    var components: [MessageComponent] = []
    for attachment in attachments {
      let url = try await relay.uploadAttachment(
        workspaceID: workspaceID,
        conversationID: conversationID,
        fileName: attachment.fileName,
        data: attachment.data
      )
      var payload = [
        "name": attachment.fileName,
        "mediaType": mediaType(for: attachment.fileName),
        "url": url,
      ]
      if let thumbnail = attachment.previewImage?.jpegData(compressionQuality: 0.85) {
        payload["thumbnail"] = thumbnail.base64EncodedString()
      }
      components.append(
        MessageComponent(id: UUID().uuidString, kind: "attachment", payload: payload)
      )
    }
    return components
  }

  private static func mediaType(for fileName: String) -> String {
    guard let type = UTType(filenameExtension: URL(fileURLWithPath: fileName).pathExtension),
      let mimeType = type.preferredMIMEType
    else { return "application/octet-stream" }
    return mimeType
  }
}
