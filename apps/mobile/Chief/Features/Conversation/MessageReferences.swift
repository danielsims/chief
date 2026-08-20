import SwiftUI
import UIKit

enum MessageReferenceSerializer {
  static func body(text: String, mentionIDs: [String], skillIDs: [String]) -> String {
    let mentions = mentionIDs.compactMap { WorkspaceAgentCatalog.agent(forID: $0) }
      .map { "@\($0.name)" }
    let skills = skillIDs.map { "[chief-skill:\($0)]" }
    let references = mentions + skills
    let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !references.isEmpty else { return clean }
    guard !clean.isEmpty else { return references.joined(separator: " ") }
    return references.joined(separator: " ") + "\n\n" + clean
  }
}

/// UIKit's text layout provides true inline attachments, so chips wrap with
/// prose instead of being approximated by a horizontal SwiftUI stack.
struct InlineReferenceText: UIViewRepresentable {
  let source: String
  let font: UIFont
  var color = UIColor.label
  var channelNames: Set<String> = []
  var onOpenChannel: (String) -> Void = { _ in }

  func makeCoordinator() -> Coordinator {
    Coordinator(parent: self)
  }

  func makeUIView(context: Context) -> UITextView {
    let view = UITextView()
    view.backgroundColor = .clear
    view.isEditable = false
    view.isSelectable = true
    view.isScrollEnabled = false
    view.textContainerInset = .zero
    view.textContainer.lineFragmentPadding = 0
    view.adjustsFontForContentSizeCategory = true
    view.linkTextAttributes = [:]
    view.delegate = context.coordinator
    view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    return view
  }

  func updateUIView(_ view: UITextView, context: Context) {
    context.coordinator.parent = self
    view.attributedText = attributedSource
  }

  func sizeThatFits(
    _ proposal: ProposedViewSize,
    uiView: UITextView,
    context: Context
  ) -> CGSize? {
    guard let width = proposal.width else { return nil }
    let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    return CGSize(width: width, height: ceil(size.height))
  }

  private var attributedSource: NSAttributedString {
    let result: NSMutableAttributedString
    if let markdown = try? AttributedString(
      markdown: source,
      options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
    ) {
      result = NSMutableAttributedString(attributedString: NSAttributedString(markdown))
      result.addAttributes(
        [.foregroundColor: color],
        range: NSRange(location: 0, length: result.length)
      )
    } else {
      result = NSMutableAttributedString(
        string: source,
        attributes: [.font: font, .foregroundColor: color]
      )
    }
    applyBaseFont(to: result)
    applyChannelLinks(to: result)
    replaceReferences(in: result)
    return result
  }

  private func applyChannelLinks(to value: NSMutableAttributedString) {
    let string = value.string
    let fullRange = NSRange(string.startIndex..., in: string)
    for match in Self.channelPattern.matches(in: string, range: fullRange) {
      guard let nameRange = Range(match.range(at: 1), in: string) else { continue }
      let candidate = String(string[nameRange])
      guard let channel = channelNames.first(where: {
        $0.caseInsensitiveCompare(candidate) == .orderedSame
      }), let url = URL(string: "chief-channel://open/\(channel)")
      else { continue }
      value.addAttributes(
        [
          .link: url,
          .foregroundColor: UIColor.systemBlue,
          .backgroundColor: UIColor.systemBlue.withAlphaComponent(0.10),
        ],
        range: match.range
      )
    }
  }

  private func applyBaseFont(to value: NSMutableAttributedString) {
    let fullRange = NSRange(location: 0, length: value.length)
    value.enumerateAttribute(.font, in: fullRange) { existing, range, _ in
      guard let existing = existing as? UIFont else {
        value.addAttribute(.font, value: font, range: range)
        return
      }
      let traits = existing.fontDescriptor.symbolicTraits
      let descriptor = font.fontDescriptor.withSymbolicTraits(traits) ?? font.fontDescriptor
      value.addAttribute(.font, value: UIFont(descriptor: descriptor, size: font.pointSize), range: range)
    }
  }

  private func replaceReferences(in value: NSMutableAttributedString) {
    var replacements: [(NSRange, String, String)] = []
    let string = value.string
    let fullRange = NSRange(string.startIndex..., in: string)

    for match in Self.skillPattern.matches(in: string, range: fullRange) {
      guard let idRange = Range(match.range(at: 1), in: string) else { continue }
      let skill = MessageSkillCatalog.skill(forID: String(string[idRange]))
      replacements.append((match.range, "book.closed", skill.label))
    }
    for match in Self.mentionPattern.matches(in: string, range: fullRange) {
      guard let nameRange = Range(match.range(at: 1), in: string),
        let agent = WorkspaceAgentCatalog.agent(forID: String(string[nameRange]))
      else { continue }
      replacements.append((match.range, "at", agent.name))
    }

    for (range, symbol, label) in replacements.sorted(by: { $0.0.location > $1.0.location }) {
      let attachment = NSTextAttachment()
      let image = ReferenceChipRenderer.image(symbol: symbol, label: label, font: font)
      attachment.image = image
      attachment.bounds = CGRect(x: 0, y: -4, width: image.size.width, height: image.size.height)
      value.replaceCharacters(in: range, with: NSAttributedString(attachment: attachment))
    }
  }

  private static let skillPattern = try! NSRegularExpression(
    pattern: #"\[chief-skill:([a-z0-9]+(?:-[a-z0-9]+)*)\]"#,
    options: [.caseInsensitive]
  )

  private static let mentionPattern: NSRegularExpression = {
    let names = WorkspaceAgentCatalog.agents.flatMap { [$0.id, $0.name] }
      .sorted { $0.count > $1.count }
      .map { NSRegularExpression.escapedPattern(for: $0) }
      .joined(separator: "|")
    return try! NSRegularExpression(
      pattern: #"(?<![\p{L}\p{N}_])@("# + names + #")(?![\p{L}\p{N}_-])"#,
      options: [.caseInsensitive]
    )
  }()

  private static let channelPattern = try! NSRegularExpression(
    pattern: #"(?<![\p{L}\p{N}_])#([\p{L}\p{N}_-]+)(?![\p{L}\p{N}_-])"#,
    options: [.caseInsensitive]
  )

  final class Coordinator: NSObject, UITextViewDelegate {
    var parent: InlineReferenceText

    init(parent: InlineReferenceText) {
      self.parent = parent
    }

    func textView(
      _ textView: UITextView,
      shouldInteractWith URL: URL,
      in characterRange: NSRange,
      interaction: UITextItemInteraction
    ) -> Bool {
      guard URL.scheme == "chief-channel" else { return true }
      let channel = URL.pathComponents.last ?? ""
      guard !channel.isEmpty else { return false }
      Haptics.medium()
      parent.onOpenChannel(channel)
      return false
    }
  }
}

private enum ReferenceChipRenderer {
  static func image(symbol: String, label: String, font: UIFont) -> UIImage {
    let chipFont = UIFont.systemFont(ofSize: max(11, font.pointSize * 0.82), weight: .semibold)
    let symbolImage = UIImage(
      systemName: symbol,
      withConfiguration: UIImage.SymbolConfiguration(pointSize: chipFont.pointSize * 0.85, weight: .semibold)
    )?.withTintColor(.label, renderingMode: .alwaysOriginal)
    let labelSize = (label as NSString).size(withAttributes: [.font: chipFont])
    let height = max(21, ceil(chipFont.lineHeight + 5))
    let width = ceil(7 + (symbolImage?.size.width ?? 0) + 4 + labelSize.width + 8)
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height))
    return renderer.image { _ in
      let bounds = CGRect(origin: .zero, size: CGSize(width: width, height: height))
      UIColor.label.withAlphaComponent(0.065).setFill()
      UIBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), cornerRadius: 6).fill()
      UIColor.label.withAlphaComponent(0.12).setStroke()
      let border = UIBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), cornerRadius: 6)
      border.lineWidth = 1
      border.stroke()
      var x: CGFloat = 7
      if let symbolImage {
        let y = (height - symbolImage.size.height) / 2
        symbolImage.draw(at: CGPoint(x: x, y: y))
        x += symbolImage.size.width + 4
      }
      (label as NSString).draw(
        at: CGPoint(x: x, y: (height - labelSize.height) / 2),
        withAttributes: [.font: chipFont, .foregroundColor: UIColor.label]
      )
    }
  }
}
