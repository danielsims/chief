import SwiftUI
import UIKit

struct RelayConnectionSettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var copied = false
  @State private var canManageProvider = false
  @State private var provider = OnboardingDraft.InferenceProvider.openCodeGo
  @State private var configuredSecrets: Set<String> = []
  @State private var apiKey = ""
  @State private var savingInference = false
  @State private var inferenceError: String?

  var body: some View {
    SettingsPage {
      HStack(spacing: 14) {
        Image(systemName: isChiefCloud ? "cloud" : "server.rack")
          .font(.system(size: 24, weight: .light))
          .frame(width: 54, height: 54)
          .background(ChiefTheme.surface, in: RoundedRectangle(cornerRadius: 15))
        VStack(alignment: .leading, spacing: 5) {
          Text(isChiefCloud ? "Chief Cloud" : "Self-hosted")
            .font(.system(size: 22, weight: .regular, design: .rounded))
          HStack(spacing: 6) {
            Circle().fill(model.workspaceSyncFailed ? Color.orange : Color.green).frame(
              width: 5, height: 5)
            Text(model.workspaceSyncFailed ? "Unavailable" : "Connected")
              .font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
          }
        }
      }
      SettingsSection(title: "Connection") {
        SettingsRow {
          Text("Relay")
          Spacer(minLength: 12)
          Button {
            UIPasteboard.general.string = relayOrigin
            copied = true
            Haptics.light()
          } label: {
            HStack(spacing: 7) {
              Text(relayHost).lineLimit(1).truncationMode(.middle)
              Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.system(size: 12))
            }.foregroundStyle(ChiefTheme.secondary)
          }
          .buttonStyle(.plain)
          .accessibilityLabel(copied ? "Relay address copied" : "Copy relay address")
        }
        SettingsRow {
          Text("Security")
          Spacer()
          Label("Signed device", systemImage: "checkmark.shield")
            .font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
        }
      }
      if canManageProvider {
        SettingsSection(title: "Agent provider") {
          SettingsRow {
            Text("Provider")
            Spacer()
            Picker("Provider", selection: $provider) {
              Text("Vercel AI Gateway").tag(OnboardingDraft.InferenceProvider.vercelAiGateway)
              Text("OpenCode").tag(OnboardingDraft.InferenceProvider.openCodeGo)
            }
            .labelsHidden()
            .tint(ChiefTheme.secondary)
            .disabled(savingInference)
            .onChange(of: provider) { _, _ in
              apiKey = ""
              inferenceError = nil
            }
          }
          SettingsRow {
            SecureField("API key", text: $apiKey)
              .textContentType(.password)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .privacySensitive()
              .disabled(savingInference)
          }
          Text(
            configuredSecrets.contains(secretName)
              ? "A key is saved. Enter a new one to replace it."
              : "Add a key to connect your agents."
          )
          .font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
          .padding(.top, 12)
          if !apiKey.isEmpty {
            Button(savingInference ? "Saving…" : "Save key") {
              Task { await saveInferenceSettings() }
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(.white, in: RoundedRectangle(cornerRadius: 12))
            .disabled(
              savingInference || apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            )
            .padding(.top, 16)
          }
          if let inferenceError {
            Text(inferenceError).font(.system(size: 13)).foregroundStyle(.red).padding(.top, 12)
          }
        }
      }
    }
    .navigationTitle("Connection")
    .task(id: model.workspace?.id) { await loadInferenceSettings() }
  }

  private var secretName: String {
    provider == .vercelAiGateway ? "vercel-ai-gateway" : "opencode"
  }

  @MainActor
  private func loadInferenceSettings() async {
    canManageProvider = false
    guard let workspace = model.workspace, let userID = model.session?.user.id else { return }
    do {
      let members = try await model.relay.workspaceMembers(workspaceID: workspace.id)
      guard
        members.contains(where: {
          $0.kind == "user" && $0.principalId == userID && $0.role == "owner"
        }),
        model.workspace?.id == workspace.id
      else { return }
      canManageProvider = true
      configuredSecrets = Set(try await model.relay.workspaceSecretNames(workspaceID: workspace.id))
      if let config = try await model.relay.loadAgentConfig(
        workspaceID: workspace.id,
        agentID: "chief"
      ), config.inference.provider == "vercel-ai-gateway" {
        provider = .vercelAiGateway
      }
    } catch {
      inferenceError = "Couldn’t load provider settings. Try again."
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
      let inference =
        provider == .vercelAiGateway
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
        guard
          var config = try await model.relay.loadAgentConfig(
            workspaceID: workspace.id,
            agentID: agent.id
          )
        else { continue }
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
      inferenceError = "Couldn’t save the key. Try again."
    }
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
