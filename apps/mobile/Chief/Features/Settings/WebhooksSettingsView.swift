import SwiftUI
import UIKit

/// Signed inbound webhooks that start a team schedule run. The relay limits
/// these to workspace owners and admins.
struct WebhooksSettingsView: View {
  @Environment(AppModel.self) private var model
  @State private var hooks: [ScheduleWebhook]?
  @State private var schedules: [WorkspaceScheduleSummary] = []
  @State private var error: String?
  @State private var forbidden = false
  @State private var busyID: String?
  @State private var creating = false
  @State private var revealed: ScheduleWebhookReveal?
  @State private var deleting: ScheduleWebhook?

  var body: some View {
    SettingsPage(intro: "Start a team run when something happens in another tool.") {
      if forbidden {
        SettingsEmptyState(
          icon: "lock", title: "Owners and admins only",
          detail: "Ask a workspace owner or admin to manage webhooks.")
      } else if let hooks {
        SettingsSection(
          title: "Webhooks",
          footer:
            "Every accepted event creates a run in its schedule. Repeated deliveries are deduplicated. Pausing a schedule also pauses its webhook intake."
        ) {
          if hooks.isEmpty {
            SettingsEmptyState(
              icon: "arrow.triangle.branch", title: "No webhooks yet",
              detail: schedules.isEmpty
                ? "First, ask an agent to create a schedule with a team and a brief."
                : "Connect a schedule to receive signed events.")
            .padding(.bottom, 4)
          } else {
            ForEach(hooks) { hook in hookRow(hook) }
          }
          if let error { SettingsNote(text: error, tone: .failure) }
        }
      } else if let error {
        SettingsNote(text: error, tone: .failure)
      } else {
        SettingsLoading()
      }
    }
    .navigationTitle("Webhooks")
    .toolbar {
      if hooks != nil, !forbidden {
        ToolbarItem(placement: .topBarTrailing) {
          Button("New webhook", systemImage: "plus") { creating = true }
            .disabled(schedules.isEmpty)
        }
      }
    }
    .task(id: model.workspace?.id) { await load() }
    .refreshable { await load() }
    .sheet(isPresented: $creating) {
      NewWebhookSheet(schedules: schedules) { name, scheduleID in
        try await create(name: name, scheduleID: scheduleID)
      }
    }
    .sheet(item: $revealed) { reveal in WebhookConnectionSheet(reveal: reveal) }
    .confirmationDialog(
      "Delete \(deleting?.name ?? "webhook")?",
      isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      titleVisibility: .visible
    ) {
      Button("Delete", role: .destructive) {
        if let hook = deleting { Task { await act(hook, "delete") } }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Services sending to this URL will stop starting runs.")
    }
  }

  private func hookRow(_ hook: ScheduleWebhook) -> some View {
    SettingsRow {
      Button {
        revealed = ScheduleWebhookReveal(webhook: hook)
      } label: {
        VStack(alignment: .leading, spacing: 4) {
          Text(hook.name).foregroundStyle(ChiefTheme.accent).lineLimit(1)
          Text(detail(hook))
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary)
            .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      if busyID == hook.id {
        ChiefSpinner().controlSize(.small)
      } else {
        Menu {
          Button("View connection", systemImage: "link") {
            revealed = ScheduleWebhookReveal(webhook: hook)
          }
          Button(
            hook.enabled ? "Disable" : "Enable",
            systemImage: hook.enabled ? "pause.circle" : "play.circle"
          ) {
            Task { await act(hook, hook.enabled ? "disable" : "enable") }
          }
          Button("Replace signing secret", systemImage: "key") {
            Task { await act(hook, "rotate") }
          }
          Button("Delete", systemImage: "trash", role: .destructive) { deleting = hook }
        } label: {
          Image(systemName: "ellipsis")
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(ChiefTheme.secondary)
            .frame(width: 34, height: 34)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Actions for \(hook.name)")
      }
    }
  }

  private func detail(_ hook: ScheduleWebhook) -> String {
    var parts = [
      schedules.first { $0.id == hook.scheduleId }?.title ?? "Schedule removed",
      hook.enabled ? "Enabled" : "Disabled",
    ]
    if let last = hook.lastDeliveryDate {
      parts.append("Last received \(SettingsFormat.dateTime(last))")
    }
    return parts.joined(separator: " · ")
  }

  private func load() async {
    guard let workspaceID = model.workspace?.id else { return }
    do {
      async let nextHooks = model.relay.scheduleWebhooks(workspaceID: workspaceID)
      async let nextSchedules = model.relay.workspaceSchedules(workspaceID: workspaceID)
      (hooks, schedules) = try await (nextHooks, nextSchedules)
      error = nil
      forbidden = false
    } catch RelayError.httpStatus(403) {
      forbidden = true
    } catch {
      self.error = SettingsFailure.message(error, fallback: "Could not load webhooks.")
    }
  }

  private func create(name: String, scheduleID: String) async throws {
    guard let workspaceID = model.workspace?.id else { return }
    let result = try await model.relay.createScheduleWebhook(
      workspaceID: workspaceID, name: name, scheduleID: scheduleID)
    creating = false
    await load()
    // Let the creation sheet finish dismissing before revealing the secret.
    try? await Task.sleep(for: .milliseconds(450))
    revealed = result
  }

  private func act(_ hook: ScheduleWebhook, _ action: String) async {
    guard let workspaceID = model.workspace?.id else { return }
    deleting = nil
    busyID = hook.id
    error = nil
    defer { busyID = nil }
    do {
      let result = try await model.relay.scheduleWebhookAction(
        workspaceID: workspaceID, webhookID: hook.id, action: action)
      Haptics.success()
      if result.secret != nil { revealed = result }
      await load()
    } catch {
      self.error = SettingsFailure.message(error, fallback: "Could not update this webhook.")
      Haptics.error()
    }
  }
}

private struct NewWebhookSheet: View {
  @Environment(\.dismiss) private var dismiss
  let schedules: [WorkspaceScheduleSummary]
  let onCreate: (String, String) async throws -> Void
  @State private var name = ""
  @State private var scheduleID = ""
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ChiefSheetHeader(title: "New webhook", doneTitle: "Cancel")
      VStack(alignment: .leading, spacing: 18) {
        Text("Choose the team schedule this event should start.")
          .font(.system(size: 14))
          .foregroundStyle(ChiefSheetPalette.secondary)
        SettingsTextField(
          title: "Name", text: $name, placeholder: "New customer feedback",
          capitalization: .sentences)
        VStack(alignment: .leading, spacing: 8) {
          Text("Schedule").font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
          Picker("Schedule", selection: $scheduleID) {
            ForEach(schedules) { schedule in
              Text(
                schedule.status == "active"
                  ? schedule.title : "\(schedule.title) (\(schedule.status))"
              )
              .tag(schedule.id)
            }
          }
          .pickerStyle(.menu)
          .tint(ChiefTheme.accent)
          .labelsHidden()
        }
        if let error { SettingsNote(text: error, tone: .failure) }
        Spacer(minLength: 0)
        Button {
          Haptics.heavy()
          Task { await submit() }
        } label: {
          if busy { ChiefSpinner().tint(.black) } else { Text("Create webhook") }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || scheduleID.isEmpty)
      }
      .padding(.horizontal, 24)
      .padding(.bottom, 20)
    }
    .chiefSheet([.height(420)])
    .onAppear { if scheduleID.isEmpty { scheduleID = schedules.first?.id ?? "" } }
  }

  private func submit() async {
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await onCreate(name.trimmingCharacters(in: .whitespaces), scheduleID)
    } catch {
      self.error = SettingsFailure.message(error, fallback: "Could not create this webhook.")
      Haptics.error()
    }
  }
}

private struct WebhookConnectionSheet: View {
  let reveal: ScheduleWebhookReveal
  @State private var copied: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ChiefSheetHeader(title: reveal.webhook.name)
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          Text(
            reveal.secret == nil
              ? "Sign requests with the secret from setup. Replace it if you have lost it."
              : "Save the signing secret now. It is only shown once."
          )
          .font(.system(size: 14))
          .foregroundStyle(reveal.secret == nil ? ChiefSheetPalette.secondary : .orange)
          copyBlock(title: "URL", value: reveal.webhook.url)
          if let secret = reveal.secret { copyBlock(title: "Signing secret", value: secret) }
          VStack(alignment: .leading, spacing: 10) {
            Text(
              "POST a JSON object, up to 64 KiB. Use a unique `webhook-id` for each event and a Unix timestamp in `webhook-timestamp`."
            )
            Text(
              "Set `webhook-signature` to `v1,` followed by the base64 HMAC-SHA256 of `id.timestamp.rawBody`. Decode the secret after removing `whsec_` to obtain the signing key."
            )
            Text(
              "Sign within five minutes of delivery. For retries, keep the event ID and body, and sign with a fresh timestamp. A 202 response includes the run ID; 409 means the schedule is paused, the webhook changed, or the ID conflicts."
            )
          }
          .font(.system(size: 12))
          .foregroundStyle(ChiefSheetPalette.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 28)
      }
    }
    .chiefSheet([.large])
  }

  private func copyBlock(title: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(title).font(.system(size: 12)).foregroundStyle(ChiefSheetPalette.secondary)
        Spacer()
        Button {
          UIPasteboard.general.string = value
          copied = title
          Haptics.light()
        } label: {
          Label(copied == title ? "Copied" : "Copy", systemImage: copied == title ? "checkmark" : "doc.on.doc")
            .font(.system(size: 12, weight: .medium))
        }
        .buttonStyle(.plain)
        .foregroundStyle(ChiefSheetPalette.primary)
        .accessibilityLabel("Copy \(title.lowercased())")
      }
      Text(value)
        .font(.system(size: 12, design: .monospaced))
        .foregroundStyle(ChiefSheetPalette.primary)
        .textSelection(.enabled)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ChiefSheetPalette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
  }
}
