import SwiftUI
import UIKit

/// An editable canonical message string presented with inline reference chips.
/// Attachments are a display detail only: the binding always contains the
/// durable `@Agent` and `[chief-skill:id]` tokens sent to the relay.
struct ComposerTextView: UIViewRepresentable {
  static let topInset: CGFloat = 12

  private static let referenceTokenKey = NSAttributedString.Key(
    "sh.heychief.composer.reference-token"
  )

  @Binding var text: String
  @Binding var selection: NSRange
  @Binding var isFocused: Bool
  @Binding var height: CGFloat

  func makeCoordinator() -> Coordinator {
    Coordinator(parent: self)
  }

  func makeUIView(context: Context) -> UITextView {
    let view = UITextView()
    view.delegate = context.coordinator
    view.backgroundColor = .clear
    view.font = .systemFont(ofSize: 16)
    view.textColor = .label
    view.tintColor = .systemBlue
    view.keyboardDismissMode = .interactive
    view.contentInsetAdjustmentBehavior = .never
    view.contentInset = .zero
    view.textContainerInset = UIEdgeInsets(
      top: Self.topInset,
      left: 11,
      bottom: 7,
      right: 11
    )
    view.textContainer.lineFragmentPadding = 0
    view.textContainer.widthTracksTextView = true
    view.textContainer.heightTracksTextView = false
    view.alwaysBounceHorizontal = false
    view.showsHorizontalScrollIndicator = false
    view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    view.adjustsFontForContentSizeCategory = true
    view.isScrollEnabled = true
    view.accessibilityLabel = "Message"
    context.coordinator.render(text, selection: selection, in: view)
    return view
  }

  func updateUIView(_ view: UITextView, context: Context) {
    context.coordinator.parent = self
    if context.coordinator.canonicalText != text {
      context.coordinator.render(text, selection: selection, in: view)
      context.coordinator.updateHeightAfterLayout(for: view)
    } else {
      let renderedSelection = context.coordinator.renderedRange(for: selection)
      if view.selectedRange != renderedSelection {
        context.coordinator.setSelection(renderedSelection, in: view)
      }
    }

    if isFocused, !view.isFirstResponder {
      view.becomeFirstResponder()
    } else if !isFocused, view.isFirstResponder {
      view.resignFirstResponder()
    }
  }

  func sizeThatFits(
    _ proposal: ProposedViewSize,
    uiView: UITextView,
    context: Context
  ) -> CGSize? {
    guard let width = proposal.width else { return nil }
    let fitting = uiView.sizeThatFits(
      CGSize(width: width, height: .greatestFiniteMagnitude)
    )
    return CGSize(width: width, height: min(140, max(48, ceil(fitting.height))))
  }

  final class Coordinator: NSObject, UITextViewDelegate {
    struct Segment {
      let canonicalRange: NSRange
      let renderedRange: NSRange
    }

    var parent: ComposerTextView
    fileprivate var canonicalText = ""
    private var segments: [Segment] = []
    private var isUpdating = false

    init(parent: ComposerTextView) {
      self.parent = parent
    }

    func render(_ source: String, selection: NSRange, in view: UITextView) {
      let font = UIFont.systemFont(ofSize: 16)
      let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: UIColor.label,
      ]
      let sourceString = source as NSString
      let result = NSMutableAttributedString(string: "")
      var sourceCursor = 0
      var nextSegments: [Segment] = []

      for match in MessageReferenceParser.matches(in: source) {
        guard match.range.location >= sourceCursor else { continue }
        let plainRange = NSRange(
          location: sourceCursor,
          length: match.range.location - sourceCursor
        )
        if plainRange.length > 0 {
          result.append(
            NSAttributedString(
              string: sourceString.substring(with: plainRange),
              attributes: attributes
            )
          )
        }

        let attachment = NSTextAttachment()
        let image = ReferenceChipRenderer.image(
          symbol: match.symbol,
          label: match.label,
          font: font
        )
        attachment.image = image
        attachment.bounds = CGRect(
          x: 0,
          y: -4,
          width: image.size.width,
          height: image.size.height
        )
        let renderedRange = NSRange(location: result.length, length: 1)
        result.append(NSAttributedString(attachment: attachment))
        result.addAttribute(
          ComposerTextView.referenceTokenKey,
          value: sourceString.substring(with: match.range),
          range: renderedRange
        )
        nextSegments.append(
          Segment(canonicalRange: match.range, renderedRange: renderedRange)
        )
        sourceCursor = NSMaxRange(match.range)
      }

      if sourceCursor < sourceString.length {
        let remainder = NSRange(
          location: sourceCursor,
          length: sourceString.length - sourceCursor
        )
        result.append(
          NSAttributedString(
            string: sourceString.substring(with: remainder),
            attributes: attributes
          )
        )
      }

      isUpdating = true
      canonicalText = source
      segments = nextSegments
      view.attributedText = result
      view.typingAttributes = attributes
      let safeLocation = min(max(0, selection.location), sourceString.length)
      let safeSelection = NSRange(
        location: safeLocation,
        length: min(max(0, selection.length), sourceString.length - safeLocation)
      )
      view.selectedRange = renderedRange(for: safeSelection)
      isUpdating = false
    }

    func setSelection(_ range: NSRange, in view: UITextView) {
      isUpdating = true
      view.selectedRange = range
      isUpdating = false
    }

    func textView(
      _ textView: UITextView,
      shouldChangeTextIn range: NSRange,
      replacementText replacement: String
    ) -> Bool {
      textView.typingAttributes = baseAttributes
      return true
    }

    func textViewDidChange(_ textView: UITextView) {
      guard !isUpdating else { return }
      refreshCanonicalState(from: textView)
      let canonicalSelection = canonicalRange(for: textView.selectedRange)
      if parent.text != canonicalText { parent.text = canonicalText }
      if parent.selection != canonicalSelection { parent.selection = canonicalSelection }
      updateHeight(for: textView)
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
      guard !isUpdating else { return }
      let canonical = canonicalRange(for: textView.selectedRange)
      if parent.selection != canonical { parent.selection = canonical }
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
      if !parent.isFocused { parent.isFocused = true }
    }

    func textViewDidEndEditing(_ textView: UITextView) {
      if parent.isFocused { parent.isFocused = false }
    }

    fileprivate func renderedRange(for canonicalRange: NSRange) -> NSRange {
      let start = renderedOffset(forCanonicalOffset: canonicalRange.location)
      let end = renderedOffset(forCanonicalOffset: NSMaxRange(canonicalRange))
      return NSRange(location: start, length: max(0, end - start))
    }

    private func canonicalRange(for renderedRange: NSRange) -> NSRange {
      let start = canonicalOffset(forRenderedOffset: renderedRange.location)
      let end = canonicalOffset(forRenderedOffset: NSMaxRange(renderedRange))
      return NSRange(location: start, length: max(0, end - start))
    }

    private func canonicalOffset(forRenderedOffset offset: Int) -> Int {
      var expansion = 0
      for segment in segments {
        if offset <= segment.renderedRange.location { return offset + expansion }
        if offset <= NSMaxRange(segment.renderedRange) {
          return NSMaxRange(segment.canonicalRange)
        }
        expansion += segment.canonicalRange.length - segment.renderedRange.length
      }
      return offset + expansion
    }

    private func renderedOffset(forCanonicalOffset offset: Int) -> Int {
      var contraction = 0
      for segment in segments {
        if offset <= segment.canonicalRange.location { return offset - contraction }
        if offset <= NSMaxRange(segment.canonicalRange) {
          return NSMaxRange(segment.renderedRange)
        }
        contraction += segment.canonicalRange.length - segment.renderedRange.length
      }
      return offset - contraction
    }

    private var baseAttributes: [NSAttributedString.Key: Any] {
      [
        .font: UIFont.systemFont(ofSize: 16),
        .foregroundColor: UIColor.label,
      ]
    }

    func updateHeight(for textView: UITextView) {
      guard textView.bounds.width > 0 else { return }
      let fitting = textView.sizeThatFits(
        CGSize(width: textView.bounds.width, height: .greatestFiniteMagnitude)
      )
      let nextHeight = min(140, max(48, ceil(fitting.height)))
      if abs(parent.height - nextHeight) > 0.5 { parent.height = nextHeight }
    }

    func updateHeightAfterLayout(for textView: UITextView) {
      DispatchQueue.main.async { [weak self, weak textView] in
        guard let self, let textView else { return }
        self.updateHeight(for: textView)
      }
    }

    private func refreshCanonicalState(from textView: UITextView) {
      let attributed = textView.attributedText ?? NSAttributedString(string: "")
      let renderedString = attributed.string as NSString
      var source = ""
      var sourceLength = 0
      var nextSegments: [Segment] = []
      let fullRange = NSRange(location: 0, length: attributed.length)

      attributed.enumerateAttribute(
        ComposerTextView.referenceTokenKey,
        in: fullRange,
        options: []
      ) { value, range, _ in
        if let token = value as? String {
          let tokenLength = (token as NSString).length
          nextSegments.append(
            Segment(
              canonicalRange: NSRange(location: sourceLength, length: tokenLength),
              renderedRange: range
            )
          )
          source += token
          sourceLength += tokenLength
        } else {
          let plain = renderedString.substring(with: range)
          source += plain
          sourceLength += (plain as NSString).length
        }
      }

      canonicalText = source
      segments = nextSegments
    }
  }
}
