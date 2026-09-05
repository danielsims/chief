import SwiftUI

enum MarkdownMessageBlock: Equatable {
  case paragraph(String)
  case heading(level: Int, text: String)
  case unordered([String])
  case ordered([String])
  case quote(String)
  case code(String)
}

enum MarkdownMessageParser {
  static func blocks(_ source: String) -> [MarkdownMessageBlock] {
    let lines = source.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    var blocks: [MarkdownMessageBlock] = []
    var index = 0

    while index < lines.count {
      let line = lines[index]
      if line.trimmingCharacters(in: .whitespaces).isEmpty {
        index += 1
        continue
      }
      if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
        index += 1
        var code: [String] = []
        while index < lines.count,
          !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("```")
        {
          code.append(lines[index])
          index += 1
        }
        if index < lines.count { index += 1 }
        blocks.append(.code(code.joined(separator: "\n")))
        continue
      }
      if let heading = heading(line) {
        blocks.append(heading)
        index += 1
        continue
      }
      if unorderedItem(line) != nil {
        var items: [String] = []
        while index < lines.count, let item = unorderedItem(lines[index]) {
          items.append(item)
          index += 1
        }
        blocks.append(.unordered(items))
        continue
      }
      if orderedItem(line) != nil {
        var items: [String] = []
        while index < lines.count, let item = orderedItem(lines[index]) {
          items.append(item)
          index += 1
        }
        blocks.append(.ordered(items))
        continue
      }
      if line.trimmingCharacters(in: .whitespaces).hasPrefix(">") {
        var quote: [String] = []
        while index < lines.count {
          let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
          guard trimmed.hasPrefix(">") else { break }
          quote.append(trimmed.dropFirst().trimmingCharacters(in: .whitespaces))
          index += 1
        }
        blocks.append(.quote(quote.joined(separator: "\n")))
        continue
      }

      var paragraph: [String] = []
      while index < lines.count {
        let candidate = lines[index]
        if candidate.trimmingCharacters(in: .whitespaces).isEmpty { break }
        if !paragraph.isEmpty && startsBlock(candidate) { break }
        paragraph.append(candidate)
        index += 1
      }
      blocks.append(.paragraph(paragraph.joined(separator: "\n")))
    }
    return blocks
  }

  private static func heading(_ line: String) -> MarkdownMessageBlock? {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    let marks = trimmed.prefix { $0 == "#" }
    guard !marks.isEmpty, marks.count <= 6 else { return nil }
    let remainder = trimmed.dropFirst(marks.count)
    guard remainder.first == " " else { return nil }
    return .heading(level: marks.count, text: remainder.trimmingCharacters(in: .whitespaces))
  }

  private static func unorderedItem(_ line: String) -> String? {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") else { return nil }
    return String(trimmed.dropFirst(2))
  }

  private static func orderedItem(_ line: String) -> String? {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard let dot = trimmed.firstIndex(of: "."), dot != trimmed.startIndex else { return nil }
    let prefix = trimmed[..<dot]
    guard prefix.allSatisfy(\.isNumber) else { return nil }
    let rest = trimmed[trimmed.index(after: dot)...]
    guard rest.first == " " else { return nil }
    return String(rest.dropFirst())
  }

  private static func startsBlock(_ line: String) -> Bool {
    heading(line) != nil
      || unorderedItem(line) != nil
      || orderedItem(line) != nil
      || line.trimmingCharacters(in: .whitespaces).hasPrefix(">")
      || line.trimmingCharacters(in: .whitespaces).hasPrefix("```")
  }
}

struct MarkdownMessageBody: View {
  @Environment(AppModel.self) private var model
  let source: String
  let channelNames: Set<String>

  var body: some View {
    VStack(alignment: .leading, spacing: 9) {
      ForEach(Array(MarkdownMessageParser.blocks(source).enumerated()), id: \.offset) { _, block in
        blockView(block)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .fixedSize(horizontal: false, vertical: true)
  }

  @ViewBuilder
  private func blockView(_ block: MarkdownMessageBlock) -> some View {
    switch block {
    case .paragraph(let text):
      inline(text, size: 15)
    case .heading(let level, let text):
      inline(text, size: level <= 2 ? 18 : 16, weight: .semibold)
        .padding(.top, level <= 2 ? 3 : 0)
    case .unordered(let items):
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("•").foregroundStyle(ChiefTheme.secondary)
            inline(item, size: 15)
          }
        }
      }
    case .ordered(let items):
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(items.enumerated()), id: \.offset) { index, item in
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(index + 1).")
              .foregroundStyle(ChiefTheme.secondary)
              .frame(minWidth: 18, alignment: .trailing)
            inline(item, size: 15)
          }
        }
      }
    case .quote(let text):
      HStack(alignment: .top, spacing: 10) {
        RoundedRectangle(cornerRadius: 1).fill(ChiefTheme.line).frame(width: 3)
        inline(text, size: 14, color: UIColor.secondaryLabel)
      }
    case .code(let text):
      ScrollView(.horizontal) {
        Text(text)
          .font(.system(size: 12, design: .monospaced))
          .padding(11)
      }
      .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: 10))
      .overlay { RoundedRectangle(cornerRadius: 10).stroke(ChiefTheme.line) }
    }
  }

  private func inline(
    _ source: String,
    size: CGFloat,
    weight: UIFont.Weight = .regular,
    color: UIColor = .label
  ) -> some View {
    InlineReferenceText(
      source: source,
      font: .systemFont(ofSize: size, weight: weight),
      color: color,
      channelNames: channelNames,
      people: model.mentionPeople,
      onOpenChannel: { model.openConversation($0) }
    )
    .fixedSize(horizontal: false, vertical: true)
  }
}
