import SwiftUI

struct AgentConfigurationView: View {
  @Binding var config: AgentConfig
  let onChange: () -> Void

  var body: some View {
    SettingsPage {
      AgentCredentialsSection(config: $config, onChange: onChange)

      SettingsSection(title: "Inference") {
        SettingsRow { LabeledContent("Model", value: config.model).font(.system(size: 13)) }
        Picker(
          "Approval",
          selection: Binding(
            get: { config.approvals },
            set: { value in
              guard value != config.approvals else { return }
              Haptics.selection()
              config.approvals = value
              onChange()
            }
          )
        ) {
          Text("Automatic").tag("auto")
          Text("Ask me").tag("ask")
        }
        .pickerStyle(.menu)
        .padding(.vertical, 12)
      }

      SettingsSection(title: "Capabilities") {
        ForEach(AgentConfig.allCapabilities, id: \.self) { capability in
          SettingsToggle(
            title: AgentSettingsCopy.displayName(capability),
            isOn: config.capabilities.contains(capability)
          ) {
            toggle(capability, in: &config.capabilities)
          }
        }
      }

      SettingsSection(title: "Connections") {
        ForEach(AgentConfig.allIntegrations, id: \.self) { integration in
          SettingsToggle(
            title: AgentSettingsCopy.displayName(integration),
            isOn: config.integrations.contains(integration)
          ) {
            toggle(integration, in: &config.integrations)
          }
        }
      }
    }
    .navigationTitle("Configuration")
  }

  private func toggle(_ value: String, in values: inout Set<String>) {
    if values.contains(value) { values.remove(value) } else { values.insert(value) }
    onChange()
  }
}

/// Owner-only: which provider this agent runs on, and the workspace key it
/// uses. Keys are stored once per workspace and shared by every agent.
private struct AgentCredentialsSection: View {
  @Environment(AppModel.self) private var model
  @Binding var config: AgentConfig
  let onChange: () -> Void

  @State private var isOwner = false
  @State private var provider = OnboardingDraft.InferenceProvider.openCodeGo
  @State private var configuredSecrets: Set<String> = []
  @State private var apiKey = ""
  @State private var saving = false
  @State private var error: String?
  @State private var saved = false

  var body: some View {
    Group {
      if isOwner {
        SettingsSection(title: "Credentials", footer: footer) {
          SettingsRow {
            Text("Service").foregroundStyle(ChiefTheme.secondary)
            Spacer()
            Picker("Provider", selection: $provider) {
              Text("Vercel AI Gateway").tag(OnboardingDraft.InferenceProvider.vercelAiGateway)
              Text("OpenCode").tag(OnboardingDraft.InferenceProvider.openCodeGo)
            }
            .labelsHidden()
            .tint(ChiefTheme.accent)
            .disabled(saving)
            .onChange(of: provider) {
              apiKey = ""
              error = nil
              saved = false
            }
          }
          SettingsTextField(
            title: "API key", text: $apiKey,
            placeholder: hasKey ? "Saved — paste to replace" : "Paste a key", secure: true
          )
          .disabled(saving)
          .onChange(of: apiKey) { saved = false }
          if canSave {
            Button {
              Haptics.heavy()
              Task { await save() }
            } label: {
              if saving { ChiefSpinner().tint(ChiefTheme.onPrimary) } else { Text("Save") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(saving)
            .padding(.top, 16)
          }
          if let error {
            SettingsNote(text: error, tone: .failure)
          } else if saved {
            SettingsNote(text: "This agent now uses \(providerName).", tone: .success)
          }
        }
      }
    }
    .task(id: model.workspace?.id) { await load() }
  }

  private var secretName: String {
    provider == .vercelAiGateway ? "vercel-ai-gateway" : "opencode"
  }

  private var providerName: String {
    provider == .vercelAiGateway ? "Vercel AI Gateway" : "OpenCode"
  }

  private var hasKey: Bool { configuredSecrets.contains(secretName) }

  private var trimmedKey: String { apiKey.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// A new key, or a switch to a provider whose key is already saved.
  private var canSave: Bool {
    !trimmedKey.isEmpty || (hasKey && config.inference.provider != secretName)
  }

  private var footer: String {
    hasKey
      ? "A key is saved for this workspace. Paste a new one to replace it for every agent."
      : "Add a key to connect this agent."
  }

  private func load() async {
    isOwner = false
    guard let workspace = model.workspace, await model.currentWorkspaceRole() == .owner,
      model.workspace?.id == workspace.id
    else { return }
    isOwner = true
    provider = config.inference.provider == "vercel-ai-gateway" ? .vercelAiGateway : .openCodeGo
    do {
      configuredSecrets = Set(try await model.relay.workspaceSecretNames(workspaceID: workspace.id))
    } catch {
      self.error = "Couldn’t load credentials. Try again."
    }
  }

  /// Stores a new key when one was entered, then points this agent at it.
  private func save() async {
    guard let workspace = model.workspace, !saving else { return }
    saving = true
    error = nil
    defer { saving = false }
    do {
      if !trimmedKey.isEmpty {
        try await model.relay.setWorkspaceSecret(
          workspaceID: workspace.id, name: secretName, value: trimmedKey)
        configuredSecrets.insert(secretName)
      }
      if config.inference.provider != secretName {
        config.inference =
          provider == .vercelAiGateway
          ? AgentInferenceConfig(
            provider: "vercel-ai-gateway", model: "deepseek/deepseek-v4-flash",
            secretRef: "vercel-ai-gateway")
          : AgentInferenceConfig(
            provider: "opencode", model: "opencode-go/deepseek-v4-flash", secretRef: "opencode")
        onChange()
      }
      apiKey = ""
      saved = true
      Haptics.success()
    } catch {
      self.error = "Couldn’t save the key. Try again."
      Haptics.error()
    }
  }
}
