import ActivityKit
import SwiftUI
import WidgetKit

@main
struct ChiefAgentActivityWidgetBundle: WidgetBundle {
  var body: some Widget { ChiefAgentLiveActivity() }
}

private struct ChiefAgentLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: ChiefAgentActivityAttributes.self) { context in
      lockScreen(context)
        .activityBackgroundTint(.black.opacity(0.82))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ActivityMatrix(phase: context.state.phase, size: 22)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            ActivityShimmerText(
              context.state.status,
              active: context.state.phase.isActive,
              font: .system(size: 15, weight: .bold, design: .rounded)
            )
            Text(context.attributes.agentName)
              .font(.system(size: 11, weight: .medium, design: .rounded))
              .foregroundStyle(.white.opacity(0.58))
              .lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          elapsed(context.attributes.startedAt)
        }
      } compactLeading: {
        ActivityMatrix(phase: context.state.phase, size: 17)
      } compactTrailing: {
        elapsed(context.attributes.startedAt).frame(maxWidth: 48)
      } minimal: {
        ActivityMatrix(phase: context.state.phase, size: 17)
      }
      .keylineTint(.white.opacity(0.72))
    }
  }

  private func lockScreen(
    _ context: ActivityViewContext<ChiefAgentActivityAttributes>
  ) -> some View {
    HStack(spacing: 13) {
      ActivityMatrix(phase: context.state.phase, size: 24)
      VStack(alignment: .leading, spacing: 3) {
        ActivityShimmerText(
          context.state.status,
          active: context.state.phase.isActive,
          font: .system(size: 15, weight: .bold, design: .rounded)
        )
        Text("\(context.attributes.agentName) · \(context.state.detail)")
          .font(.system(size: 12, weight: .medium, design: .rounded))
          .foregroundStyle(.white.opacity(0.58))
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      elapsed(context.attributes.startedAt)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 18)
  }

  private func elapsed(_ startedAt: Date) -> some View {
    Text(timerInterval: startedAt...Date.distantFuture, countsDown: false)
      .font(.system(size: 12, weight: .semibold, design: .monospaced))
      .foregroundStyle(.white.opacity(0.72))
      .monospacedDigit()
      .lineLimit(1)
  }
}

private struct ActivityMatrix: View {
  let phase: ChiefAgentActivityAttributes.ContentState.Phase
  let size: CGFloat
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion || !phase.isActive)) {
      timeline in
      let gap = size * 2 / 15
      let cell = (size - gap * 2) / 3
      VStack(spacing: gap) {
        ForEach(0..<3, id: \.self) { row in
          HStack(spacing: gap) {
            ForEach(0..<3, id: \.self) { column in
              RoundedRectangle(cornerRadius: cell * 0.24)
                .fill(.white)
                .frame(width: cell, height: cell)
                .opacity(opacity(row * 3 + column, at: timeline.date))
            }
          }
        }
      }
    }
    .frame(width: size, height: size)
    .accessibilityLabel(phase.isActive ? "Working" : "Finished")
  }

  private func opacity(_ index: Int, at date: Date) -> Double {
    guard phase.isActive, !reduceMotion else { return 0.45 }
    let offsets = [0.0, 7.0 / 9.0, 5.0 / 9.0, 7.0 / 9.0, 5.0 / 9.0,
      3.0 / 9.0, 5.0 / 9.0, 3.0 / 9.0, 1.0 / 9.0]
    let cycle = (date.timeIntervalSinceReferenceDate / (9.0 / 7.0) + offsets[index])
      .truncatingRemainder(dividingBy: 1)
    let linear = cycle <= 0.4 ? cycle / 0.4 : 1 - ((cycle - 0.4) / 0.6)
    let eased = (1 - cos(.pi * max(0, min(1, linear)))) / 2
    return 0.14 + 0.64 * eased
  }
}

private struct ActivityShimmerText: View {
  let value: String
  let active: Bool
  let font: Font
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  init(_ value: String, active: Bool, font: Font) {
    self.value = value
    self.active = active
    self.font = font
  }

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion || !active)) {
      timeline in
      let progress = timeline.date.timeIntervalSinceReferenceDate
        .truncatingRemainder(dividingBy: 2.2) / 2.2
      Text(value)
        .font(font)
        .foregroundStyle(active && !reduceMotion ? LinearGradient(
          colors: [.white.opacity(0.46), .white, .white.opacity(0.46)],
          startPoint: UnitPoint(x: 1.8 - 2.6 * progress, y: 0.5),
          endPoint: UnitPoint(x: 4.2 - 2.6 * progress, y: 0.5)
        ) : LinearGradient(colors: [.white, .white], startPoint: .leading, endPoint: .trailing))
    }
    .lineLimit(1)
    .accessibilityLabel(value)
  }
}

private extension ChiefAgentActivityAttributes.ContentState.Phase {
  var isActive: Bool {
    switch self {
    case .thinking, .usingTool: true
    case .completed, .paused: false
    }
  }
}
