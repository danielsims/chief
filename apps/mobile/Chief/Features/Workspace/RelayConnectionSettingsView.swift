import SwiftUI
import UIKit

struct RelayConnectionSettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var copied = false
  @State private var provider = OnboardingDraft.InferenceProvider.openCodeGo
  @State private var configuredSecrets: Set<String> = []
  @State private var apiKey = ""
  @State private var savingInference = false
  @State private var inferenceError: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        connectionCard
        inferenceCard
      }
      .padding(ChiefTheme.pagePadding)
    }
    .background(ChiefTheme.background)
    .navigationTitle("Connection")
    .navigationBarTitleDisplayMode(.inline)
    .task { await loadInferenceSettings() }
  }

  private var inferenceCard: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Hosted agents")
          .font(.system(size: 17, weight: .semibold))
        Text("Choose the inference provider for this workspace’s agents.")
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
      }

      HStack(spacing: 8) {
        providerButton(.vercelAiGateway, title: "Vercel AI Gateway")
        providerButton(.openCodeGo, title: "OpenCode")
      }

      SecureField("\(providerName) API key", text: $apiKey)
        .textContentType(.password)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .textFieldStyle(ChiefTextFieldStyle())
        .privacySensitive()

      HStack {
        Text(
          configuredSecrets.contains(secretName)
            ? "\(providerName) is configured. Its credential cannot be read back."
            : "Add your \(providerName) API key to use this provider."
        )
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
        Spacer(minLength: 12)
        Button(configuredSecrets.contains(secretName) ? "Replace" : "Save") {
          Task { await saveInferenceSettings() }
        }
        .buttonStyle(.borderedProminent)
        .tint(.white)
        .foregroundStyle(.black)
        .disabled(apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || savingInference)
      }

      if let inferenceError {
        Text(inferenceError)
          .font(.system(size: 13))
          .foregroundStyle(Color.red)
      }
    }
    .padding(16)
    .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: ChiefTheme.cardRadius))
    .overlay {
      RoundedRectangle(cornerRadius: ChiefTheme.cardRadius)
        .stroke(ChiefTheme.line, lineWidth: 1)
    }
  }

  private func providerButton(
    _ value: OnboardingDraft.InferenceProvider,
    title: String
  ) -> some View {
    Button {
      provider = value
      apiKey = ""
      Haptics.selection()
    } label: {
      Text(title)
        .font(.system(size: 13, weight: .medium))
        .frame(maxWidth: .infinity, minHeight: 42)
        .background(
          provider == value ? ChiefTheme.elevated : ChiefTheme.background,
          in: RoundedRectangle(cornerRadius: 10)
        )
        .overlay {
          RoundedRectangle(cornerRadius: 10)
            .stroke(provider == value ? Color.primary : ChiefTheme.line, lineWidth: 1)
        }
    }
    .buttonStyle(.plain)
  }

  private var secretName: String {
    provider == .vercelAiGateway ? "vercel-ai-gateway" : "opencode"
  }

  private var providerName: String {
    provider == .vercelAiGateway ? "Vercel AI Gateway" : "OpenCode"
  }

  @MainActor
  private func loadInferenceSettings() async {
    guard let workspace = model.workspace else { return }
    do {
      configuredSecrets = Set(try await model.relay.workspaceSecretNames(workspaceID: workspace.id))
      if let config = try await model.relay.loadAgentConfig(
        workspaceID: workspace.id,
        agentID: "chief"
      ), config.inference.provider == "vercel-ai-gateway" {
        provider = .vercelAiGateway
      }
    } catch {
      inferenceError = error.localizedDescription
    }
  }

  @MainActor
  private func saveInferenceSettings() async {
    guard let workspace = model.workspace else { return }
    let value = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty, !savingInference else { return }
    savingInference = true
    inferenceError = nil
    defer { savingInference = false }
    do {
      try await model.relay.setWorkspaceSecret(
        workspaceID: workspace.id,
        name: secretName,
        value: value
      )
      let inference = provider == .vercelAiGateway
        ? AgentInferenceConfig(
          provider: "vercel-ai-gateway",
          model: "deepseek/deepseek-v4-flash",
          secretRef: "vercel-ai-gateway"
        )
        : AgentInferenceConfig(
          provider: "opencode",
          model: "opencode-go/deepseek-v4-flash",
          secretRef: "opencode"
        )
      for agent in workspace.agents {
        guard var config = try await model.relay.loadAgentConfig(
          workspaceID: workspace.id,
          agentID: agent.id
        ) else { continue }
        config.inference = inference
        try await model.relay.saveAgentConfig(
          workspaceID: workspace.id,
          agentID: agent.id,
          config: config
        )
      }
      configuredSecrets.insert(secretName)
      apiKey = ""
      Haptics.success()
    } catch {
      inferenceError = error.localizedDescription
    }
  }

  private var connectionCard: some View {
    VStack(spacing: 0) {
      HStack(alignment: .top, spacing: 13) {
        Group {
          if isChiefCloud {
            Image(systemName: "cloud.fill")
          } else {
            Image(systemName: "server.rack")
          }
        }
        .font(.system(size: 18, weight: .medium))
        .frame(width: 42, height: 42)
        .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 12))

        VStack(alignment: .leading, spacing: 4) {
          Text(model.workspace?.name ?? "Workspace connection")
            .font(.system(size: 17, weight: .semibold))
          Text(
            isChiefCloud
              ? "Chief manages this workspace’s relay and updates."
              : "This workspace runs on infrastructure managed by your team."
          )
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 4)
      }
      .padding(16)

      Divider().overlay(ChiefTheme.line)
      detailRow("Status") {
        Label(
          model.workspaceSyncFailed ? "Unavailable" : "Connected",
          systemImage: model.workspaceSyncFailed ? "exclamationmark.circle.fill" : "circle.fill"
        )
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(model.workspaceSyncFailed ? Color.orange : Color.green)
      }
      Divider().overlay(ChiefTheme.line)
      detailRow("Hosting") {
        Text(isChiefCloud ? "Chief Cloud" : "Self-hosted")
      }
      Divider().overlay(ChiefTheme.line)
      detailRow("Relay address") {
        Button {
          UIPasteboard.general.string = relayOrigin
          copied = true
          Haptics.light()
          Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
          }
        } label: {
          HStack(spacing: 7) {
            Text(relayHost)
              .lineLimit(1)
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
          }
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(copied ? "Relay address copied" : "Copy relay address")
      }
      Divider().overlay(ChiefTheme.line)
      detailRow("Identity") {
        Label("Signed device", systemImage: "checkmark.shield")
          .font(.system(size: 13))
      }
    }
    .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: ChiefTheme.cardRadius))
    .overlay {
      RoundedRectangle(cornerRadius: ChiefTheme.cardRadius)
        .stroke(ChiefTheme.line, lineWidth: 1)
    }
  }

  private func detailRow<Content: View>(
    _ label: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    HStack(spacing: 16) {
      Text(label)
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
      Spacer(minLength: 16)
      content()
    }
    .frame(minHeight: 50)
    .padding(.horizontal, 16)
  }

  private var isChiefCloud: Bool {
    RelayDirectoryStore.sameOrigin(
      model.appConfiguration.relayURL,
      AppConfiguration.chiefCloud().relayURL
    )
  }

  private var relayOrigin: String {
    var components = URLComponents(
      url: model.appConfiguration.relayURL,
      resolvingAgainstBaseURL: false
    )
    components?.path = ""
    components?.query = nil
    components?.fragment = nil
    return components?.url?.absoluteString ?? model.appConfiguration.relayURL.absoluteString
  }

  private var relayHost: String {
    model.appConfiguration.relayURL.host ?? relayOrigin
  }
}
