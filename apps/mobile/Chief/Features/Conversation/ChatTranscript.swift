import SwiftUI
import UIKit

// MARK: - Transcript row model

/// One item in a conversation transcript: either a day separator or a message
/// with a flag for whether its author header is shown (grouping).
struct TranscriptRow: Identifiable {
  enum Payload {
    case daySeparator(String)
    case message(ConversationMessage, showsAuthor: Bool)
  }

  let id: String
  let payload: Payload
}

/// Builds display rows for a sorted message list, inserting day separators and
/// collapsing consecutive messages from the same author within five minutes.
enum ChatTimelineBuilder {
  static let groupingWindow: TimeInterval = 5 * 60

  static func rows(
    for messages: [ConversationMessage],
    calendar: Calendar = .current
  ) -> [TranscriptRow] {
    var rows: [TranscriptRow] = []
    var previous: ConversationMessage?
    var previousDay: Date?

    for message in messages {
      if message.isAgentActivityProjection { continue }
      let day = calendar.startOfDay(for: message.createdAt)
      if previousDay == nil || day != previousDay {
        rows.append(
          TranscriptRow(
            id: "day-\(day.timeIntervalSince1970)",
            payload: .daySeparator(dayLabel(for: message.createdAt, calendar: calendar))
          )
        )
      }
      let showsAuthor: Bool = {
        guard let previous else { return true }
        return previousDay != day
          || authorKey(message) != authorKey(previous)
          || message.createdAt.timeIntervalSince(previous.createdAt) > groupingWindow
      }()
      rows.append(
        TranscriptRow(id: message.id, payload: .message(message, showsAuthor: showsAuthor))
      )
      previous = message
      previousDay = day
    }
    return rows
  }

  static func authorKey(_ message: ConversationMessage) -> String {
    switch message.author {
    case .user(let id, _): "user:\(id)"
    case .agent(let id, _): "agent:\(id)"
    case .system: "system"
    }
  }

  static func dayLabel(for date: Date, calendar: Calendar = .current) -> String {
    if calendar.isDateInToday(date) { return "Today" }
    if calendar.isDateInYesterday(date) { return "Yesterday" }
    let formatter = DateFormatter()
    formatter.dateFormat = "EEEE, MMMM d, y"
    return formatter.string(from: date)
  }
}

enum ConversationScrollAnchor {
  static func isNearLatest(_ geometry: ScrollGeometry, threshold: CGFloat = 96) -> Bool {
    geometry.contentSize.height <= geometry.containerSize.height + 1
      || geometry.visibleRect.maxY >= geometry.contentSize.height - threshold
  }

  static func followKey(for messages: [ConversationMessage]) -> String {
    let visible = messages.filter { !$0.isAgentActivityProjection }
    guard let last = visible.last else { return "empty" }
    let components = last.components
      .map { "\($0.id):\($0.kind):\($0.payload.count)" }
      .joined(separator: ",")
    return "\(visible.count):\(last.id):\(last.body.count):\(components)"
  }
}

// MARK: - Day separator

/// A quiet "TODAY / YESTERDAY / Monday, August 17, 2026" label between hairlines.
struct DaySeparator: View {
  let label: String

  var body: some View {
    HStack(spacing: 9) {
      Rectangle()
        .fill(ChiefTheme.line.opacity(0.7))
        .frame(height: 1)
      Text(label)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(ChiefTheme.tertiary)
        .padding(.horizontal, 11)
        .padding(.vertical, 5)
        .background(ChiefTheme.surface.opacity(0.65), in: Capsule())
        .overlay { Capsule().stroke(ChiefTheme.line.opacity(0.7)) }
        .fixedSize()
      Rectangle()
        .fill(ChiefTheme.line.opacity(0.7))
        .frame(height: 1)
    }
    .padding(.vertical, 6)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
  }
}

// MARK: - Message body (mentions + channel references)

/// Renderable segment of a message body: plain text, an `@Agent` mention, or a
/// `#channel` reference.
enum MessageBodySegment: Equatable {
  case text(String)
  case mention(agentID: String, label: String)
  case channel(channelID: String, label: String)
}

/// Splits a raw message body into text / mention / channel segments. Mention
/// resolution mirrors `AgentMentionParser`; channel references only render as
/// chips when the name matches an actual workspace channel (unknown `#foo` is
/// left as plain text, matching the desktop `channel-reference-parser`).
enum MessageBodyParser {
  static func split(
    _ text: String,
    channelNames: Set<String>,
    people: [MentionAgent] = []
  ) -> [MessageBodySegment] {
    guard !text.isEmpty else { return [.text("")] }
    let names = (WorkspaceAgentCatalog.agents + people)
      .flatMap(WorkspaceAgentCatalog.mentionableNames(for:))
      .sorted { $0.count > $1.count }
    let escapedNames =
      names
      .map { NSRegularExpression.escapedPattern(for: $0) }
      .joined(separator: "|")
    let pattern =
      "(?<![\\p{L}\\p{N}_])(?:@(?:\(escapedNames))|#([\\p{L}\\p{N}_-]+))(?![\\p{L}\\p{N}_-])"
    let regex = try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])

    var segments: [MessageBodySegment] = []
    let nsRange = NSRange(text.startIndex..., in: text)
    let matches = regex.matches(in: text, options: [], range: nsRange)
    var cursor = text.startIndex

    for match in matches {
      guard let range = Range(match.range, in: text) else { continue }
      if range.lowerBound > cursor {
        segments.append(.text(String(text[cursor..<range.lowerBound])))
      }
      let token = String(text[range])
      if token.hasPrefix("@") {
        let name = String(token.dropFirst())
        if let agent = WorkspaceAgentCatalog.named(name, people: people) {
          segments.append(.mention(agentID: agent.id, label: token))
        } else {
          segments.append(.text(token))
        }
      } else {
        let name = token.hasPrefix("#") ? String(token.dropFirst()) : token
        let lower = name.lowercased()
        if let channel = channelNames.first(where: { $0.lowercased() == lower }) {
          segments.append(.channel(channelID: channel, label: "#\(channel)"))
        } else {
          segments.append(.text(token))
        }
      }
      cursor = range.upperBound
    }
    if cursor < text.endIndex {
      segments.append(.text(String(text[cursor...])))
    }
    return segments
  }
}

/// A single wrapping `Text` that renders `@Agent` mentions and `#channel`
/// references as tinted inline runs (desktop `ChannelReferenceText` →
/// `AgentMentionText`). One Text guarantees the body wraps within its container
/// instead of overflowing the right edge (the custom flow layout is banned by
/// the PRD).
struct MessageBody: View {
  let text: String
  var channelNames: Set<String> = []

  var body: some View {
    MarkdownMessageBody(source: text, channelNames: channelNames)
  }
}

// MARK: - Keyboard follow

/// Keeps the latest message just above the composer as the keyboard or the
/// composer moves. Both shrink the transcript's uncovered height — as a bottom
/// inset or a smaller frame — which on its own leaves the messages where they
/// were, so the scroll offset moves by the same amount in the same pass. The
/// keyboard's inset arrives through the safe area, which isn't observable, so
/// its notification re-checks inside the keyboard's own animation.
struct LatestMessagePin: UIViewRepresentable {
  func makeUIView(context: Context) -> PinView { PinView() }
  func updateUIView(_ view: PinView, context: Context) {}

  final class PinView: UIView {
    private var observations: [NSKeyValueObservation] = []
    /// The height of the transcript not covered by the composer or keyboard.
    private var viewport: CGFloat?

    override func didMoveToWindow() {
      super.didMoveToWindow()
      observations = []
      viewport = nil
      NotificationCenter.default.removeObserver(self)
      guard window != nil, let scrollView = enclosingScrollView else { return }
      viewport = Self.viewport(of: scrollView)
      observations = [
        scrollView.observe(\UIScrollView.contentInset) { [weak self] scrollView, _ in
          MainActor.assumeIsolated { self?.follow(scrollView) }
        },
        scrollView.observe(\UIScrollView.bounds) { [weak self] scrollView, _ in
          MainActor.assumeIsolated { self?.follow(scrollView) }
        },
      ]
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(keyboardWillChangeFrame),
        name: UIResponder.keyboardWillChangeFrameNotification,
        object: nil
      )
    }

    @objc private func keyboardWillChangeFrame(_ notification: Notification) {
      guard let scrollView = enclosingScrollView, let info = notification.userInfo,
        let duration = info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double,
        let curve = info[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt
      else { return }
      UIView.animate(
        withDuration: duration,
        delay: 0,
        options: [UIView.AnimationOptions(rawValue: curve << 16), .beginFromCurrentState]
      ) {
        scrollView.superview?.layoutIfNeeded()
        self.follow(scrollView)
      }
    }

    private func follow(_ scrollView: UIScrollView) {
      let new = Self.viewport(of: scrollView)
      guard let old = viewport, new != old else { return }
      viewport = new
      // Only while the latest message was in view, and never against a finger.
      guard !scrollView.isTracking, !scrollView.isDecelerating,
        scrollView.contentOffset.y + old >= scrollView.contentSize.height - 96
      else { return }
      let top = -scrollView.adjustedContentInset.top
      let bottom = max(top, scrollView.contentSize.height - new)
      scrollView.contentOffset.y = min(max(scrollView.contentOffset.y + old - new, top), bottom)
    }

    private var enclosingScrollView: UIScrollView? {
      var view = superview
      while let current = view {
        if let scrollView = current as? UIScrollView { return scrollView }
        view = current.superview
      }
      return nil
    }

    private static func viewport(of scrollView: UIScrollView) -> CGFloat {
      scrollView.bounds.height - scrollView.adjustedContentInset.bottom
    }
  }
}
