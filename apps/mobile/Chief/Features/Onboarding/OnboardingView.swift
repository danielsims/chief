import SwiftUI

struct OnboardingView: View {
  @Environment(AppModel.self) private var model
  private let stepCount = 4

  var body: some View {
    @Bindable var model = model
    ZStack(alignment: .bottom) {
      ChiefTheme.background.ignoresSafeArea()
      VStack(spacing: 0) {
        OnboardingAccountIndicator()

        Group {
          switch model.onboarding.step {
          case 0: CompanyStep(draft: $model.onboarding)
          case 1: RuntimeStep(draft: $model.onboarding)
          case 2:
            InferenceStep(
              draft: $model.onboarding,
              credential: $model.inferenceCredential
            )
          default: AppsStep(draft: $model.onboarding)
          }
        }
        .frame(maxHeight: .infinity)

        VStack(spacing: 11) {
          OnboardingProgressSegments(currentStep: model.onboarding.step)
            .padding(.bottom, 5)

          Button {
            Haptics.heavy()
            if model.onboarding.step == stepCount - 1 {
              Task { await model.completeOnboarding() }
            } else {
              model.onboarding.step += 1
            }
          } label: {
            if model.onboardingInProgress {
              ProgressView().tint(.black)
            } else {
              Text(model.onboarding.step == stepCount - 1 ? "Enter workspace" : "Continue")
            }
          }
          .buttonStyle(PrimaryButtonStyle())
          .disabled(!model.canAdvanceOnboarding || model.onboardingInProgress)

          if model.onboarding.step > 0 {
            Button("Back") {
              Haptics.light()
              model.onboarding.step -= 1
            }
              .font(.system(size: 13, weight: .medium))
              .foregroundStyle(ChiefTheme.secondary)
              .frame(height: 24)
              .buttonStyle(.plain)
          } else {
            Button("Back") {
              Haptics.medium()
              model.showWorkspaceSetup()
            }
              .font(.system(size: 13, weight: .medium))
              .foregroundStyle(ChiefTheme.secondary)
              .frame(height: 24)
              .buttonStyle(.plain)
          }
        }
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.top, 12)
        .padding(.bottom, 10)
      }

      if let error = model.onboardingError {
        Text(error)
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(.white)
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(.regularMaterial, in: Capsule())
          .padding(.bottom, 92)
      }
    }
    .task {
      // Warm the plugin catalog and all its logos up front so the Apps step
      // renders the full, resolved list with every icon already cached.
      let plugins = await PluginCatalogClient.shared.preferredPlugins()
      await BrandLogoImage.prefetch(urls: plugins.compactMap(\.iconURL))
    }
  }
}

struct WorkspaceSetupView: View {
  @Environment(AppModel.self) private var model
  @State private var joinSheetPresented = false

  var body: some View {
    ZStack {
      ChiefTheme.background.ignoresSafeArea()
      VStack(spacing: 0) {
        OnboardingAccountIndicator()

        VStack(alignment: .leading, spacing: 0) {
          Spacer()

          Text("Set up your workspace")
            .font(.system(size: 30, weight: .regular, design: .rounded))
            .tracking(-0.8)
          Text("Start somewhere new or join a workspace shared with you.")
            .font(.system(size: 15))
            .foregroundStyle(ChiefTheme.secondary)
            .padding(.top, 9)

          VStack(spacing: 2) {
            WorkspaceSetupAction(
              title: "Create a workspace",
              detail: "Start a new space for your agents and team"
            ) {
              Haptics.heavy()
              model.beginWorkspaceSetup()
            }
            WorkspaceSetupAction(
              title: "Join with an invitation",
              detail: "Open a workspace someone shared with you"
            ) {
              Haptics.heavy()
              joinSheetPresented = true
            }
          }
          .padding(.top, 24)

          Spacer()
        }
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.bottom, 24)

        if model.canReturnToWorkspace {
          Button("Back") {
            Haptics.light()
            Task { await model.returnToWorkspaceFromSetup() }
          }
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(ChiefTheme.secondary)
          .frame(height: 24)
          .buttonStyle(.plain)
          .padding(.horizontal, ChiefTheme.pagePadding)
          .padding(.bottom, 10)
        }
      }
    }
    .sheet(isPresented: $joinSheetPresented) { JoinWorkspaceSheet() }
  }
}

private struct WorkspaceSetupAction: View {
  let title: String
  let detail: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.system(size: 15, weight: .medium))
          .foregroundStyle(.primary)
        Text(detail)
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 14)
      .padding(.vertical, 14)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

private struct OnboardingAccountIndicator: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let user = model.session?.user {
      HStack(spacing: 8) {
        UserAvatar(user: user, size: 28)
        Text(user.name)
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(1)
        Text("·")
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.tertiary)
        Button("Sign out") {
          Haptics.heavy()
          model.signOut()
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
        .buttonStyle(.plain)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.top, 12)
      .padding(.bottom, 4)
    }
  }
}

private struct RuntimeStep: View {
  @Binding var draft: OnboardingDraft
  @Environment(AppModel.self) private var model

  var body: some View {
    OnboardingStepLayout(
      title: "Where should your agents run?",
      detail: "Keep them available in Chief Cloud or run them on this iPhone."
    ) {
      OptionRow(
        icon: {
          if model.activeRelayIsChiefCloud {
            Image("ChiefMark")
              .resizable()
              .scaledToFit()
              .frame(width: 20, height: 20)
          } else {
            Image(systemName: "server.rack")
          }
        },
        title: model.activeRelayLabel,
        detail: "Keep agents working through this relay when your devices are offline.",
        selected: draft.runtime == .cloud
      ) {
        draft.runtime = .cloud
        draft.inferenceProvider = .openCodeGo
        draft.inferenceModel = "auto"
      }
      Divider().overlay(ChiefTheme.line)
      OptionRow(
        icon: { Image(systemName: "iphone") },
        title: "This iPhone",
        detail: "Run a lightweight agent privately on this device.",
        selected: draft.runtime == .phone
      ) {
        draft.runtime = .phone
      }
    }
  }
}

private struct InferenceStep: View {
  @Binding var draft: OnboardingDraft
  @Binding var credential: String
  @Environment(AppModel.self) private var model
  @State private var modelPickerPresented = false
  @State private var openCodeModels = OpenCodeModelCatalog.fallback
  @State private var loadingOpenCodeModels = false

  var body: some View {
    OnboardingStepLayout(
      title: "What inference provider will your agents use?",
      detail: "Choose what powers this workspace's agents."
    ) {
      if draft.runtime == .cloud {
        OptionRow(
          icon: {
            BrandLogoView(
              domain: "vercel.com",
              iconURL: URL(string: "https://integrations.sh/logo/vercel.com"),
              size: 20
            )
          },
          title: "Vercel AI Gateway",
          detail: "One API for hundreds of models, with budgets, usage monitoring, and fallbacks.",
          selected: draft.inferenceProvider == .vercelAiGateway
        ) {
          credential = ""
          draft.inferenceProvider = .vercelAiGateway
          draft.inferenceModel = "deepseek/deepseek-v4-flash"
        }
        Divider().overlay(ChiefTheme.line)
        OptionRow(
          icon: { OpenCodeMark(size: 20) },
          title: "OpenCode",
          detail: "An open-source coding agent for the terminal, desktop, and IDE.",
          selected: draft.inferenceProvider == .openCodeGo
        ) {
          credential = ""
          draft.inferenceProvider = .openCodeGo
          draft.inferenceModel = "opencode-go/deepseek-v4-flash"
        }
        VStack(alignment: .leading, spacing: 10) {
          SecureField(
            draft.inferenceProvider == .vercelAiGateway
              ? "Vercel AI Gateway API key" : "OpenCode API key",
            text: $credential
          )
            .textContentType(.password)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textFieldStyle(ChiefTextFieldStyle())
            .privacySensitive()
          Text("Saved to this workspace's protected relay vault.")
            .font(.system(size: 13))
            .foregroundStyle(ChiefTheme.tertiary)
          Link(destination: providerKeyURL) {
            Label(providerKeyLabel, systemImage: "arrow.up.right")
              .font(.system(size: 13, weight: .medium))
              .foregroundStyle(ChiefTheme.secondary)
          }
        }
      } else {
        OptionRow(
          icon: {
            BrandLogoView(
              domain: "vercel.com",
              iconURL: URL(string: "https://integrations.sh/logo/vercel.com"),
              size: 20
            )
          },
          title: "Vercel AI Gateway",
          detail: "One API for hundreds of models, with budgets, usage monitoring, and fallbacks.",
          selected: draft.inferenceProvider == .vercelAiGateway
        ) {
          credential = ""
          draft.inferenceProvider = .vercelAiGateway
          draft.inferenceModel = "deepseek/deepseek-v4-flash"
          draft.deviceModelID = nil
        }
        Divider().overlay(ChiefTheme.line)
        OptionRow(
          icon: { OpenCodeMark(size: 20) },
          title: "OpenCode",
          detail: "An open-source coding agent for the terminal, desktop, and IDE.",
          selected: draft.inferenceProvider == .openCodeGo
        ) {
          credential = ""
          draft.inferenceProvider = .openCodeGo
          draft.inferenceModel = OpenCodeModelCatalog.recommendedFreeModelID
          draft.deviceModelID = nil
        }
        Divider().overlay(ChiefTheme.line)
        OptionRow(
          icon: { Image(systemName: "internaldrive") },
          title: "On device",
          detail: "Download a private model that runs directly on this iPhone.",
          selected: draft.inferenceProvider == .onDevice
        ) {
          credential = ""
          draft.inferenceProvider = .onDevice
          draft.inferenceModel = ""
          draft.deviceModelID = nil
          modelPickerPresented = true
        }

        if draft.inferenceProvider == .openCodeGo
          || draft.inferenceProvider == .vercelAiGateway
        {
          VStack(alignment: .leading, spacing: 10) {
            if draft.inferenceProvider == .openCodeGo {
              OpenCodeModelPicker(
                selectedID: $draft.inferenceModel,
                models: openCodeModels,
                loading: loadingOpenCodeModels
              )
            }
            SecureField(
              draft.inferenceProvider == .vercelAiGateway
                ? "Vercel AI Gateway API key" : "OpenCode API key",
              text: $credential
            )
            .textContentType(.password)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textFieldStyle(ChiefTextFieldStyle())
            .privacySensitive()
            Link(destination: providerKeyURL) {
              Label(providerKeyLabel, systemImage: "arrow.up.right")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(ChiefTheme.secondary)
            }
          }
        }
      }
    }
    .task(id: draft.inferenceProvider) {
      guard draft.runtime == .phone, draft.inferenceProvider == .openCodeGo else { return }
      loadingOpenCodeModels = true
      openCodeModels = await OpenCodeModelCatalog.load()
      if !openCodeModels.contains(where: { $0.id == draft.inferenceModel }) {
        draft.inferenceModel =
          openCodeModels.first?.id ?? OpenCodeModelCatalog.recommendedFreeModelID
      }
      loadingOpenCodeModels = false
    }
    .sheet(isPresented: $modelPickerPresented) {
      DeviceModelPickerSheet(
        selectedID: $draft.deviceModelID,
        store: model.deviceModels
      ) { model in
        draft.inferenceModel = model.id
      }
      .chiefSheet([.medium, .large])
    }
  }

  private var providerKeyLabel: String {
    draft.inferenceProvider == .vercelAiGateway
      ? "Get a Vercel AI Gateway key" : "Get an OpenCode access token"
  }

  private var providerKeyURL: URL {
    URL(
      string: draft.inferenceProvider == .vercelAiGateway
        ? "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keysin"
        : "https://opencode.ai/auth"
    )!
  }
}

private struct OpenCodeModelPicker: View {
  @Binding var selectedID: String
  let models: [OpenCodeModelOption]
  let loading: Bool

  private var selected: OpenCodeModelOption? {
    models.first { $0.id == selectedID }
  }

  var body: some View {
    Menu {
      ForEach(models) { model in
        Button {
          selectedID = model.id
          Haptics.medium()
        } label: {
          Label(
            "\(model.displayName) · \(model.access.rawValue)",
            systemImage: selectedID == model.id ? "checkmark" : "circle"
          )
        }
      }
    } label: {
      HStack(spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Model")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(ChiefTheme.tertiary)
          Text(loading ? "Loading models…" : (selected?.displayName ?? selectedID))
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(.white)
        }
        Spacer()
        Image(systemName: "chevron.up.chevron.down")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      .padding(.horizontal, 13)
      .frame(minHeight: 52)
      .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .stroke(ChiefTheme.line)
      }
    }
    .buttonStyle(.plain)
    .disabled(loading || models.isEmpty)
    .accessibilityLabel("OpenCode model")
    .accessibilityValue(selected.map { "\($0.displayName), \($0.access.rawValue)" } ?? selectedID)
  }
}

/// Ported from the iOS Durable Agent's model manager: an on-device model
/// picker as a sheet, with chip icons (never a provider logo) and download
/// controls per model.
private struct DeviceModelPickerSheet: View {
  @Binding var selectedID: String?
  let store: OnDeviceModelStore
  let onSelect: (DeviceModel) -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("On-device models")
          .font(.system(size: 17, weight: .semibold))
        Spacer()
        Button("Done") { dismiss() }
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(.white)
      }
      .padding(.horizontal, 24)
      .padding(.top, 20)
      .padding(.bottom, 16)

      ScrollView {
        VStack(spacing: 8) {
          ForEach(store.models) { model in
            DeviceModelSheetRow(
              model: model,
              selected: selectedID == model.id,
              store: store
            ) {
              selectedID = model.id
              onSelect(model)
            }
          }
          Text(
            "Models download onto this iPhone and stay available offline. You can swap models for your agents at any time."
          )
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.tertiary)
          .padding(.horizontal, 24)
          .padding(.top, 8)
        }
        .padding(.horizontal, 12)
      }
    }
    .background(ChiefSheetPalette.background)
    .tint(ChiefTheme.accent)
  }
}

private struct DeviceModelSheetRow: View {
  let model: DeviceModel
  let selected: Bool
  let store: OnDeviceModelStore
  let onSelect: () -> Void

  var body: some View {
    Button(action: onSelect) {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: "cpu")
          .font(.system(size: 17, weight: .medium))
          .foregroundStyle(ChiefTheme.secondary)
          .frame(width: 34, height: 34)
          .background(
            ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        VStack(alignment: .leading, spacing: 3) {
          Text(model.displayName).font(.system(size: 15, weight: .semibold))
          Text(model.summary)
            .font(.system(size: 13))
            .foregroundStyle(ChiefTheme.secondary)
            .lineLimit(2)
          Text("\(model.sizeLabel) download")
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.tertiary)
        }
        Spacer(minLength: 8)
        controls
      }
      .padding(12)
      .background(
        selected ? Color.white.opacity(0.08) : Color.clear,
        in: RoundedRectangle(cornerRadius: 13, style: .continuous)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 13, style: .continuous)
          .stroke(selected ? ChiefTheme.line : Color.clear)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityValue(selected ? "Selected" : "Not selected")
  }

  @ViewBuilder
  private var controls: some View {
    if store.isDownloaded(model.id) {
      Image(systemName: selected ? "checkmark.circle.fill" : "checkmark.circle")
        .font(.system(size: 22))
        .foregroundStyle(selected ? .white : ChiefTheme.secondary)
    } else if store.isDownloading(model.id) {
      ProgressView()
    } else {
      Button("Download") {
        Task { await store.download(model) }
      }
      .font(.system(size: 13, weight: .medium))
      .buttonStyle(.bordered)
      .tint(.white)
    }
  }
}

private struct CompanyStep: View {
  @Binding var draft: OnboardingDraft

  var body: some View {
    OnboardingStepLayout(
      title: "What’s the name of this workspace?",
      detail: "Add a website if there’s one your agents should understand."
    ) {
      TextField("Workspace name", text: $draft.companyName)
        .textFieldStyle(ChiefTextFieldStyle())
      TextField("Website (optional)", text: $draft.website)
        .textContentType(.URL)
        .textInputAutocapitalization(.never)
        .keyboardType(.URL)
        .textFieldStyle(ChiefTextFieldStyle())
    }
  }
}

private struct AppsStep: View {
  @Binding var draft: OnboardingDraft

  var body: some View {
    OnboardingStepLayout(
      title: "What apps do you already use?",
      detail: "Choose the apps your team already uses."
    ) {
      LazyVGrid(
        columns: Array(repeating: GridItem(.flexible()), count: 3),
        spacing: 9
      ) {
        ForEach(apps) { app in
          BrandChoice(
            title: app.name,
            domain: app.domain,
            iconURL: app.iconURL,
            selected: draft.selectedApps.contains(app.domain)
          ) {
            if draft.selectedApps.contains(app.domain) {
              draft.selectedApps.remove(app.domain)
            } else {
              draft.selectedApps.insert(app.domain)
            }
          }
        }
      }
    }
  }

  /// The catalog is warmed when onboarding starts, so this list is fully
  /// resolved before the Apps step is ever shown.
  private var apps: [PluginOption] {
    PluginCatalogClient.shared.cached ?? PluginOption.preferred
  }
}

private struct OnboardingStepLayout<Content: View>: View {
  let title: String
  let detail: String
  @ViewBuilder let content: Content

  var body: some View {
    GeometryReader { geometry in
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Spacer(minLength: 24)
          VStack(alignment: .leading, spacing: 12) {
            Text(title)
              .font(.system(size: 30, weight: .regular, design: .rounded))
              .tracking(-0.8)
            Text(detail)
              .font(.system(size: 15))
              .foregroundStyle(ChiefTheme.secondary)
              .lineSpacing(3)
            VStack(spacing: 10) { content }.padding(.top, 22)
          }
          Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .leading)
        .padding(.horizontal, ChiefTheme.pagePadding)
      }
      .scrollDismissesKeyboard(.interactively)
    }
  }
}

private struct OnboardingProgressSegments: View {
  let currentStep: Int

  var body: some View {
    HStack(spacing: 7) {
      ForEach(0..<4, id: \.self) { index in
        Capsule()
          .fill(index <= currentStep ? Color.white : ChiefTheme.elevated)
          .frame(maxWidth: .infinity)
          .frame(height: 3)
      }
    }
    .animation(.easeOut(duration: 0.22), value: currentStep)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Step \(currentStep + 1) of 4")
  }
}

/// An elegant, list-style option: a soft icon tile, two lines of text, and a
/// selection checkmark. No boxed card, per the onboarding design direction.
private struct OptionRow<Icon: View>: View {
  @ViewBuilder let icon: () -> Icon
  let title: String
  let detail: String
  let selected: Bool
  let action: () -> Void

  var body: some View {
    Button {
      Haptics.selection()
      action()
    } label: {
      HStack(spacing: 14) {
        icon()
          .font(.system(size: 17, weight: .medium))
          .foregroundStyle(selected ? .white : ChiefTheme.secondary)
          .frame(width: 40, height: 40)
          .background(
            selected ? Color.white.opacity(0.14) : ChiefTheme.elevated,
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
          )
        VStack(alignment: .leading, spacing: 3) {
          Text(title).font(.system(size: 16, weight: .medium))
          Text(detail)
            .font(.system(size: 14))
            .foregroundStyle(ChiefTheme.secondary)
            .lineSpacing(1)
            .fixedSize(horizontal: false, vertical: true)
        }
        Spacer()
        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
          .font(.system(size: 20))
          .foregroundStyle(selected ? .white : ChiefTheme.tertiary)
      }
      .padding(.vertical, 14)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
    .accessibilityHint(detail)
  }
}

private struct BrandChoice: View {
  let title: String
  let domain: String
  let iconURL: URL?
  let selected: Bool
  let action: () -> Void

  var body: some View {
    Button {
      Haptics.selection()
      action()
    } label: {
      VStack(alignment: .leading, spacing: 11) {
        BrandLogoView(domain: domain, iconURL: iconURL, size: 32)
        Text(title).font(.system(size: 13, weight: .medium)).lineLimit(2)
      }
      .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
      .padding(10)
      .background(
        selected ? ChiefTheme.accent.opacity(0.10) : ChiefTheme.surface,
        in: RoundedRectangle(cornerRadius: 13)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 13)
          .stroke(selected ? ChiefTheme.accent : ChiefTheme.line)
      }
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
  }
}
