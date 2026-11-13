import SwiftUI

struct AgentConfigurationView: View {
  @Environment(AppModel.self) private var appModel
  let agentName: String
  @Binding var config: AgentConfig
  let onChange: () -> Void
  @State private var models: [ProviderModel] = []
  @State private var choosing: Choice?

  private enum Choice: String, Identifiable {
    case runtime, provider, model
    var id: String { rawValue }
  }

  private var runtime: AgentRuntimeOption { AgentRuntimeOption(deploymentTarget: config.deploymentTarget) }

  private var provider: AgentProviderOption {
    AgentProviderOption(rawValue: config.inference.provider) ?? .openCode
  }

  private var modelLabel: String {
    models.first { $0.value == config.inference.model }?.label
      ?? ProviderModelCatalog.label(config.inference.model)
  }

  var body: some View {
    SettingsPage {
      SettingsSection(
        title: "Runtime and model",
        footer: "\(agentName) runs \(runtime.location) using \(provider.title)."
      ) {
        choiceRow("Runtime", value: runtime.title, choice: .runtime) { RuntimeTile(runtime: runtime) }
        choiceRow("Inference provider", value: provider.title, choice: .provider) { ProviderTile(provider: provider) }
        choiceRow("Model", value: modelLabel, choice: .model) { SymbolTile(symbol: "cpu") }
      }

      if let secretRef = provider.secretRef {
        AgentCredentialsSection(providerName: provider.title, secretRef: secretRef)
      }

      SettingsSection(title: "Approvals") {
        SettingsRow {
          Text("Approval").foregroundStyle(ChiefTheme.secondary)
          Spacer()
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
          .labelsHidden()
          .tint(ChiefTheme.accent)
        }
      }
    }
    .navigationTitle("Configuration")
    .task(id: "\(provider.rawValue):\(config.inference.model)") {
      models = await ProviderModelCatalog.models(
        for: provider, current: config.inference.model,
        relay: appModel.relay, workspaceID: appModel.workspace?.id)
    }
    .sheet(item: $choosing) { choice in
      switch choice {
      case .runtime:
        AgentChoiceSheet(
          title: "Runtime",
          options: AgentRuntimeOption.allCases.map { option in
            AgentChoice(id: option.rawValue, title: option.title, detail: nil) { RuntimeTile(runtime: option) }
          },
          selected: runtime.rawValue
        ) { id in
          if let option = AgentRuntimeOption(rawValue: id) { setRuntime(option) }
        }
      case .provider:
        AgentChoiceSheet(
          title: "Inference provider",
          options: runtime.providers.map { option in
            AgentChoice(id: option.rawValue, title: option.title, detail: nil) { ProviderTile(provider: option) }
          },
          selected: provider.rawValue
        ) { id in
          if let option = AgentProviderOption(rawValue: id) { setProvider(option) }
        }
      case .model:
        AgentChoiceSheet(
          title: "Model",
          options: models.map { model in
            AgentChoice(id: model.value, title: model.label, detail: model.detail) { EmptyView() }
          },
          selected: config.inference.model,
          searchable: models.count > 8
        ) { setModel($0) }
      }
    }
  }

  private func choiceRow<Icon: View>(
    _ title: String, value: String, choice: Choice, @ViewBuilder icon: () -> Icon
  ) -> some View {
    Button {
      Haptics.light()
      choosing = choice
    } label: {
      SettingsRow {
        icon()
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
          Text(value).font(.system(size: 15, weight: .medium)).lineLimit(1).truncationMode(.middle)
        }
        Spacer(minLength: 8)
        SettingsChevron()
      }
    }
    .buttonStyle(.plain)
  }

  private func setRuntime(_ value: AgentRuntimeOption) {
    guard value != runtime else { return }
    config.deploymentTarget = value.deploymentTarget(current: config.deploymentTarget)
    // A provider the new runtime doesn't offer moves to the first it does.
    if !value.providers.contains(provider), let first = value.providers.first {
      config.inference = first.defaultInference
    }
    onChange()
  }

  private func setProvider(_ value: AgentProviderOption) {
    guard value != provider else { return }
    config.inference = value.defaultInference
    onChange()
  }

  private func setModel(_ value: String) {
    guard value != config.inference.model else { return }
    config.inference.model = value
    onChange()
  }
}

/// One option in an `AgentChoiceSheet`.
struct AgentChoice: Identifiable {
  let id: String
  let title: String
  let detail: String?
  let icon: AnyView

  init<Icon: View>(id: String, title: String, detail: String?, @ViewBuilder icon: () -> Icon) {
    self.id = id
    self.title = title
    self.detail = detail
    self.icon = AnyView(icon())
  }
}

/// Picks one runtime, provider or model: full names, a check on the current one.
struct AgentChoiceSheet: View {
  @Environment(\.dismiss) private var dismiss
  let title: String
  let options: [AgentChoice]
  let selected: String
  var searchable = false
  let onSelect: (String) -> Void
  @State private var query = ""

  private var shown: [AgentChoice] {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return options }
    return options.filter {
      $0.title.localizedCaseInsensitiveContains(trimmed)
        || ($0.detail ?? "").localizedCaseInsensitiveContains(trimmed)
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      ChiefSheetHeader(title: title)
      if searchable {
        ChiefSearchField(prompt: "Search models", text: $query).padding(.top, 12)
      }
      ScrollView {
        LazyVStack(spacing: 0) {
          ForEach(shown) { option in
            Button {
              Haptics.selection()
              onSelect(option.id)
              dismiss()
            } label: {
              HStack(spacing: 12) {
                option.icon
                VStack(alignment: .leading, spacing: 2) {
                  Text(option.title).font(.system(size: 15, weight: .medium)).lineLimit(1)
                  if let detail = option.detail, detail != option.title {
                    Text(detail).font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary).lineLimit(1)
                  }
                }
                Spacer(minLength: 8)
                if option.id == selected {
                  Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(ChiefTheme.primary)
                }
              }
              .frame(minHeight: 52)
              .contentShape(Rectangle())
              .overlay(alignment: .bottom) { SettingsHairline() }
            }
            .buttonStyle(.plain)
          }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
      }
    }
    .chiefSheet(searchable ? [.large] : [.medium])
  }
}

/// Desktop's Chief relay and On device marks, on the same tile as providers.
private struct RuntimeTile: View {
  let runtime: AgentRuntimeOption

  var body: some View {
    switch runtime {
    case .relay:
      Image("ChiefMark")
        .resizable()
        .scaledToFill()
        .frame(width: 30, height: 30)
        .clipShape(RoundedRectangle(cornerRadius: 8.4, style: .continuous))
    case .onDevice:
      SymbolTile(symbol: "laptopcomputer")
    }
  }
}

/// A provider's logo on its brand tile, as desktop shows it.
private struct ProviderTile: View {
  let provider: AgentProviderOption

  var body: some View {
    switch provider {
    case .openCode: AgentProviderLogoView(asset: "ProviderOpenCode", size: 30)
    case .chatGPT: AgentProviderLogoView(asset: "ProviderOpenAI", size: 30)
    case .claude: AgentProviderLogoView(asset: "ProviderClaude", size: 30)
    case .vercelAIGateway:
      Image("Plugin-vercel-com")
        .resizable()
        .scaledToFill()
        .frame(width: 30, height: 30)
        .clipShape(RoundedRectangle(cornerRadius: 8.4, style: .continuous))
    }
  }
}

private struct SymbolTile: View {
  let symbol: String

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: 13, weight: .medium))
      .foregroundStyle(ChiefTheme.primary)
      .frame(width: 30, height: 30)
      .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 8.4, style: .continuous))
  }
}

/// Owner-only: the workspace key the provider signs in with. Keys are stored
/// once per workspace and shared by every agent that uses that provider.
private struct AgentCredentialsSection: View {
  @Environment(AppModel.self) private var model
  let providerName: String
  let secretRef: String

  @State private var isOwner = false
  @State private var configured = false
  @State private var apiKey = ""
  @State private var saving = false
  @State private var error: String?
  @State private var saved = false

  var body: some View {
    Group {
      if isOwner {
        SettingsSection(title: "\(providerName) key", footer: footer) {
          SettingsTextField(
            title: "API key", text: $apiKey,
            placeholder: configured ? "Saved — paste to replace" : "Paste a key", secure: true
          )
          .disabled(saving)
          .onChange(of: apiKey) { saved = false }
          if !trimmedKey.isEmpty {
            Button {
              Haptics.heavy()
              Task { await save() }
            } label: {
              if saving { ChiefSpinner().tint(ChiefTheme.onPrimary) } else { Text("Save key") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(saving)
            .padding(.top, 16)
          }
          if let error {
            SettingsNote(text: error, tone: .failure)
          } else if saved {
            SettingsNote(text: "Saved for every agent that uses \(providerName).", tone: .success)
          }
        }
      }
    }
    .task(id: "\(model.workspace?.id ?? ""):\(secretRef)") { await load() }
  }

  private var trimmedKey: String { apiKey.trimmingCharacters(in: .whitespacesAndNewlines) }

  private var footer: String {
    configured
      ? "A key is saved for this workspace. Paste a new one to replace it."
      : "Add a key so this agent can run."
  }

  private func load() async {
    isOwner = false
    apiKey = ""
    saved = false
    error = nil
    guard let workspace = model.workspace, await model.currentWorkspaceRole() == .owner,
      model.workspace?.id == workspace.id
    else { return }
    isOwner = true
    do {
      configured = try await model.relay.workspaceSecretNames(workspaceID: workspace.id).contains(secretRef)
    } catch {
      self.error = "Couldn’t load credentials. Try again."
    }
  }

  private func save() async {
    guard let workspace = model.workspace, !saving else { return }
    saving = true
    error = nil
    defer { saving = false }
    do {
      try await model.relay.setWorkspaceSecret(workspaceID: workspace.id, name: secretRef, value: trimmedKey)
      configured = true
      apiKey = ""
      saved = true
      Haptics.success()
    } catch {
      self.error = "Couldn’t save the key. Try again."
      Haptics.error()
    }
  }
}
