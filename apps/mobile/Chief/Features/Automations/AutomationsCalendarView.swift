import SwiftUI

/// Desktop's automations calendar for a phone: a month of days marked with
/// the runs on them, and the selected day's runs listed underneath.
struct AutomationsCalendarView: View {
  @Environment(AppModel.self) private var model
  let schedules: [WorkspaceSchedule]
  let onUpdate: (WorkspaceSchedule) -> Void
  @State private var month = Calendar.current.dateInterval(of: .month, for: .now)?.start ?? .now
  @State private var selected = Calendar.current.startOfDay(for: .now)
  /// Runs recorded in months already looked at, by automation.
  @State private var recorded: [String: Set<Double>] = [:]

  private var calendar: Calendar { .current }

  private struct Occurrence: Identifiable {
    let schedule: WorkspaceSchedule
    let at: Date
    var id: String { "\(schedule.id):\(at.timeIntervalSince1970)" }
    var isPast: Bool { at <= .now }
  }

  /// Every run, past and upcoming, by the day it falls on.
  private var byDay: [Date: [Occurrence]] {
    var days: [Date: [Occurrence]] = [:]
    for schedule in schedules {
      let times = Set(schedule.occurrences).union(recorded[schedule.id] ?? [])
      for time in times {
        let at = Date(timeIntervalSince1970: time / 1000)
        days[calendar.startOfDay(for: at), default: []].append(Occurrence(schedule: schedule, at: at))
      }
    }
    return days.mapValues { $0.sorted { $0.at < $1.at } }
  }

  var body: some View {
    let byDay = byDay
    VStack(alignment: .leading, spacing: 0) {
      monthBar
      weekdays
      grid(byDay)
      Rectangle().fill(ChiefTheme.line).frame(height: 0.5).padding(.vertical, 16)
      agenda(byDay[selected] ?? [])
    }
    .task(id: "\(model.workspace?.id ?? ""):\(month.timeIntervalSince1970)") { await loadHistory() }
    .onChange(of: model.workspace?.id) { recorded = [:] }
  }

  // MARK: Month

  private var monthBar: some View {
    HStack(spacing: 8) {
      Text(month.formatted(.dateTime.month(.wide).year()))
        .font(.system(size: 17, weight: .semibold))
      Spacer(minLength: 8)
      if !calendar.isDate(selected, inSameDayAs: .now) || !calendar.isDate(month, equalTo: .now, toGranularity: .month) {
        Button("Today") {
          Haptics.light()
          selected = calendar.startOfDay(for: .now)
          month = calendar.dateInterval(of: .month, for: .now)?.start ?? month
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(ChiefTheme.accent)
        .padding(.horizontal, 11)
        .frame(height: 30)
        .background(ChiefTheme.elevated, in: Capsule())
      }
      monthButton("chevron.left", label: "Previous month", by: -1)
      monthButton("chevron.right", label: "Next month", by: 1)
    }
    .padding(.bottom, 14)
  }

  private func monthButton(_ symbol: String, label: String, by months: Int) -> some View {
    Button {
      Haptics.light()
      guard let next = calendar.date(byAdding: .month, value: months, to: month) else { return }
      month = next
      selected = calendar.isDate(next, equalTo: .now, toGranularity: .month)
        ? calendar.startOfDay(for: .now) : next
    } label: {
      Image(systemName: symbol)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(ChiefTheme.accent)
        .frame(width: 30, height: 30)
        .background(ChiefTheme.elevated, in: Circle())
        .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }

  private var weekdays: some View {
    let symbols = calendar.veryShortStandaloneWeekdaySymbols
    let first = calendar.firstWeekday - 1
    return HStack(spacing: 0) {
      ForEach(0..<7, id: \.self) { index in
        Text(symbols[(index + first) % 7])
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(ChiefTheme.tertiary)
          .frame(maxWidth: .infinity)
      }
    }
    .padding(.bottom, 6)
  }

  /// The month's days, padded to whole weeks from the locale's first weekday.
  private var days: [Date?] {
    guard let count = calendar.range(of: .day, in: .month, for: month)?.count else { return [] }
    let leading = (calendar.component(.weekday, from: month) - calendar.firstWeekday + 7) % 7
    let dates = (0..<count).compactMap { calendar.date(byAdding: .day, value: $0, to: month) }
    let cells: [Date?] = Array(repeating: nil, count: leading) + dates
    return cells + Array(repeating: nil, count: (7 - cells.count % 7) % 7)
  }

  private func grid(_ byDay: [Date: [Occurrence]]) -> some View {
    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 2) {
      ForEach(Array(days.enumerated()), id: \.offset) { _, day in
        if let day {
          dayCell(day, runs: byDay[day] ?? [])
        } else {
          Color.clear.frame(height: 50)
        }
      }
    }
  }

  private func dayCell(_ day: Date, runs: [Occurrence]) -> some View {
    let isToday = calendar.isDateInToday(day)
    let isSelected = day == selected
    return Button {
      Haptics.selection()
      selected = day
    } label: {
      VStack(spacing: 4) {
        Text(day.formatted(.dateTime.day()))
          .font(.system(size: 15, weight: isToday || isSelected ? .semibold : .regular))
          .monospacedDigit()
          .foregroundStyle(isToday ? ChiefTheme.onPrimary : ChiefTheme.accent)
          .frame(width: 32, height: 32)
          .background {
            if isToday {
              Circle().fill(ChiefTheme.primary)
            } else if isSelected {
              Circle().fill(ChiefTheme.elevated)
            }
          }
        HStack(spacing: 3) {
          ForEach(runs.prefix(3)) { run in
            Circle()
              .fill(ChiefTheme.agentColor(run.schedule.agentId))
              .frame(width: 5, height: 5)
              .opacity(run.isPast ? 0.4 : 1)
          }
        }
        .frame(height: 5)
      }
      .frame(maxWidth: .infinity, minHeight: 50)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(day.formatted(date: .complete, time: .omitted))
    .accessibilityValue(runs.isEmpty ? "" : "\(runs.count) \(runs.count == 1 ? "run" : "runs")")
  }

  // MARK: Day

  private func agenda(_ runs: [Occurrence]) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(selected.formatted(.dateTime.weekday(.wide).day().month(.wide)))
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(ChiefTheme.secondary)
      if runs.isEmpty {
        Text("Nothing runs this day.")
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.tertiary)
          .padding(.vertical, 8)
      }
      ForEach(runs) { run in
        NavigationLink {
          AutomationDetailView(schedule: run.schedule, onUpdate: onUpdate)
        } label: {
          AgendaRow(schedule: run.schedule, at: run.at, isPast: run.isPast)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
      }
    }
  }

  /// The runs recorded around the month on screen; the relay answers up to
  /// 93 days at a time, so this asks for the month either side too.
  private func loadHistory() async {
    guard let workspaceID = model.workspace?.id,
      let from = calendar.date(byAdding: .month, value: -1, to: month),
      let to = calendar.date(byAdding: .month, value: 2, to: month),
      let loaded = try? await model.relay.schedules(
        workspaceID: workspaceID, from: from.timeIntervalSince1970 * 1000,
        to: to.timeIntervalSince1970 * 1000),
      model.workspace?.id == workspaceID
    else { return }
    for schedule in loaded {
      recorded[schedule.id, default: []].formUnion(schedule.recordedRuns ?? [])
    }
  }
}

/// One run on the selected day: when, what, and who leads it.
private struct AgendaRow: View {
  @Environment(AppModel.self) private var model
  let schedule: WorkspaceSchedule
  let at: Date
  let isPast: Bool

  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      Text(at.formatted(date: .omitted, time: .shortened))
        .font(.system(size: 13))
        .monospacedDigit()
        .foregroundStyle(ChiefTheme.secondary)
        .frame(width: 62, alignment: .leading)
      HStack(spacing: 10) {
        Circle()
          .fill(ChiefTheme.agentColor(schedule.agentId))
          .frame(width: 7, height: 7)
        VStack(alignment: .leading, spacing: 2) {
          Text(schedule.title)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(ChiefTheme.accent)
            .lineLimit(1)
          Text(isPast ? "\(lead) · Ran" : lead)
            .font(.system(size: 12))
            .foregroundStyle(ChiefTheme.secondary)
            .lineLimit(1)
        }
        Spacer(minLength: 8)
        AutomationInvolvedStack(
          lead: schedule.agentId, collaborators: schedule.collaborators, steps: schedule.steps,
          size: 18)
      }
      .padding(.horizontal, 12)
      .frame(minHeight: 54)
      .background(ChiefTheme.accent.opacity(0.045), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(ChiefTheme.accent.opacity(0.06))
      }
    }
    .opacity(isPast ? 0.65 : 1)
    .contentShape(Rectangle())
  }

  private var lead: String {
    model.workspace?.agentDisplayName(schedule.agentId) ?? schedule.agentId.capitalized
  }
}
