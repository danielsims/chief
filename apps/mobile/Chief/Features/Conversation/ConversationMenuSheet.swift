import SwiftUI

struct ConversationMenuSheet: View {
  @Environment(\.dismiss) private var dismiss
  let openActivity: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ChiefSheetHeader(title: "Conversation")
      ChiefSheetMenuRow(
        icon: "waveform.path.ecg",
        title: "Activity",
        detail: "Agent thinking and tool calls"
      ) {
        dismiss()
        Task { @MainActor in
          try? await Task.sleep(for: .milliseconds(180))
          openActivity()
        }
      }
    }
    .chiefSheet([.height(150)])
  }
}
