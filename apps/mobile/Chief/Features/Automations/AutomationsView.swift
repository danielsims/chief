import SwiftUI

struct AutomationsView: View {
  @Environment(AppModel.self) private var model
  @State private var schedules: [WorkspaceSchedule]?
  @State private var failed = false
  @State private var search = ""
  @State private var showsCalendar = false

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Automations")
            .font(.system(size: 26, weight: .regular, design: .rounded))
            .tracking(-0.6)
        }
        Spacer(minLength: 0)
        if schedules?.isEmpty == false {
          ChiefModePicker(
            selection: $showsCalendar,
            options: [
              .init(value: false, symbol: "list.bullet", label: "List"),
              .init(value: true, symbol: "calendar", label: "Calendar"),
            ])
        }
      }
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.top, 16)
      if schedules?.isEmpty == false, !showsCalendar {
        ChiefSearchField(prompt: "Search automations", text: $search)
      }
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
          if let schedules, schedules.isEmpty {
            EmptyAutomationsView()
          } else if let schedules {
            if showsCalendar {
              AutomationsCalendarView(schedules: schedules, onUpdate: update)
            } else {
              if filtered(schedules).isEmpty {
                ContentUnavailableView.search(text: search)
                  .foregroundStyle(ChiefTheme.secondary)
              }
              ForEach(filtered(schedules)) { schedule in
                NavigationLink {
                  AutomationDetailView(schedule: schedule, onUpdate: update)
                } label: {
                  AutomationRow(schedule: schedule)
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
              }
            }
          } else if failed {
            Text("Couldn’t load automations. Check your connection.")
              .font(.system(size: 14))
              .foregroundStyle(ChiefTheme.secondary)
              .padding(.top, 36)
          } else {
            ChiefSpinner()
              .tint(ChiefTheme.accent)
              .frame(maxWidth: .infinity)
              .padding(.top, 36)
          }
        }
        .padding(.horizontal, ChiefTheme.pagePadding)
        .padding(.top, 2)
        .padding(.bottom, ChiefTheme.pagePadding)
      }
      .refreshable { await load() }
    }
    .background(ChiefTheme.background)
    .task(id: model.workspace?.id) {
      schedules = nil
      await load()
    }
    .onChange(of: model.selectedTab) { _, tab in
      if tab == .automations { Task { await load() } }
    }
  }

  private func filtered(_ schedules: [WorkspaceSchedule]) -> [WorkspaceSchedule] {
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty else { return schedules }
    return schedules.filter { $0.title.localizedCaseInsensitiveContains(query) }
  }

  private func update(_ schedule: WorkspaceSchedule) {
    schedules = schedules?.map { $0.id == schedule.id ? schedule : $0 }
  }

  private func load() async {
    guard let workspaceID = model.workspace?.id else { return }
    async let catalogue: Void = AutomationCatalogue.shared.load(
      workspaceID: workspaceID, relay: model.relay)
    do {
      let loaded = try await model.relay.schedules(workspaceID: workspaceID)
      guard model.workspace?.id == workspaceID else { return }
      schedules = loaded.sorted { $0.updatedAt > $1.updatedAt }
      failed = false
    } catch {
      if !(error is CancellationError) { failed = true }
    }
    await catalogue
  }
}

/// An automation as desktop lists it: when it runs and its status in the
/// band, its title and everyone and everything it involves in the card.
private struct AutomationRow: View {
  let schedule: WorkspaceSchedule

  var body: some View {
    InsetBand {
      Text(schedule.timing).frame(maxWidth: .infinity, alignment: .leading)
      AutomationStatusLabel(status: schedule.status)
      Image(systemName: "arrow.up.right")
        .font(.system(size: 11))
        .foregroundStyle(ChiefTheme.tertiary)
    } content: {
      VStack(alignment: .leading, spacing: 10) {
        Text(schedule.title)
          .font(.system(size: 15, weight: .medium))
          .foregroundStyle(ChiefTheme.accent)
          .multilineTextAlignment(.leading)
          .lineLimit(2)
        AutomationInvolvedStack(
          lead: schedule.agentId, collaborators: schedule.collaborators, steps: schedule.steps)
      }
    }
    .contentShape(Rectangle())
  }
}

private struct EmptyAutomationsView: View {
  var body: some View {
    ChiefCard {
      VStack(spacing: 12) {
        Image(systemName: "clock.arrow.circlepath")
          .font(.system(size: 26))
          .foregroundStyle(ChiefTheme.secondary)
        Text("No automations yet")
          .font(.system(size: 17, weight: .semibold))
        Text("Ask Chief to do something regularly and it sets one up.")
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
          .multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity)
      .padding(.vertical, 22)
    }
    .padding(.top, 8)
  }
}
