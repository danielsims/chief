import XCTest

@testable import Chief

final class ConversationPresentationTests: XCTestCase {
  private var calendar: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    return calendar
  }

  func testTimelineStartsWithDateSeparatorAndGroupsNearbyMessages() {
    let messages = [
      message(id: "first", author: .agent(id: "chief", name: "Chief"), minute: 0),
      message(id: "second", author: .agent(id: "chief", name: "Chief"), minute: 1),
      message(id: "third", author: .agent(id: "chief", name: "Chief"), minute: 7),
    ]

    let rows = ChatTimelineBuilder.rows(for: messages, calendar: calendar)

    XCTAssertEqual(rows.count, 4)
    guard case .daySeparator = rows[0].payload,
      case .message(_, let firstShowsAuthor) = rows[1].payload,
      case .message(_, let secondShowsAuthor) = rows[2].payload,
      case .message(_, let thirdShowsAuthor) = rows[3].payload
    else {
      return XCTFail("Unexpected transcript row structure")
    }
    XCTAssertTrue(firstShowsAuthor)
    XCTAssertFalse(secondShowsAuthor)
    XCTAssertTrue(thirdShowsAuthor)
  }

  func testTimelineSeparatesEachDay() {
    let firstDay = message(id: "first", author: .system, minute: 0)
    let nextDay = message(id: "second", author: .system, minute: 24 * 60)

    let rows = ChatTimelineBuilder.rows(for: [firstDay, nextDay], calendar: calendar)

    XCTAssertEqual(
      rows.compactMap { row in
        if case .daySeparator = row.payload { return row.id }
        return nil
      }.count,
      2
    )
  }

  func testTimelineDoesNotGroupDifferentAuthors() {
    let messages = [
      message(id: "user", author: .user(id: "user-1", name: "Daniel"), minute: 0),
      message(id: "agent", author: .agent(id: "chief", name: "Chief"), minute: 1),
    ]

    let rows = ChatTimelineBuilder.rows(for: messages, calendar: calendar)

    guard case .message(_, let showsAuthor) = rows.last?.payload else {
      return XCTFail("Expected a message row")
    }
    XCTAssertTrue(showsAuthor)
  }

  func testMessageBodyOnlyPromotesKnownChannels() {
    let segments = MessageBodyParser.split(
      "Use #mission-control, not #missing.",
      channelNames: ["mission-control"]
    )

    XCTAssertTrue(
      segments.contains(.channel(channelID: "mission-control", label: "#mission-control"))
    )
    XCTAssertFalse(
      segments.contains { segment in
        if case .channel(let channelID, _) = segment { return channelID == "missing" }
        return false
      }
    )
  }

  func testMarkdownParserBuildsNativeBlocksWithoutLeakingMarkup() {
    let blocks = MarkdownMessageParser.blocks(
      """
      ## Launch plan

      - Ship the app
      - Verify **notifications**

      > Keep it conversational.

      ```swift
      let ready = true
      ```
      """
    )

    XCTAssertEqual(
      blocks,
      [
        .heading(level: 2, text: "Launch plan"),
        .unordered(["Ship the app", "Verify **notifications**"]),
        .quote("Keep it conversational."),
        .code("let ready = true"),
      ]
    )
  }

  func testMarkdownParserKeepsChannelReferencesInsideParagraphs() {
    XCTAssertEqual(
      MarkdownMessageParser.blocks("Work in #mission-control today."),
      [.paragraph("Work in #mission-control today.")]
    )
  }

  func testMessageReferencesSerializeAgentAndSkillBeforeBody() {
    XCTAssertEqual(
      MessageReferenceSerializer.body(
        text: "Please start the research.",
        mentionIDs: ["prospector"],
        skillIDs: ["find-buying-signals"]
      ),
      "@Prospector [chief-skill:find-buying-signals]\n\nPlease start the research."
    )
  }

  func testMessageReferencesSerializeWithoutBody() {
    XCTAssertEqual(
      MessageReferenceSerializer.body(
        text: "",
        mentionIDs: ["brand"],
        skillIDs: ["build-brand-profile"]
      ),
      "@Marketer [chief-skill:build-brand-profile]"
    )
  }

  private func message(
    id: String,
    author: ConversationMessage.Author,
    minute: Int
  ) -> ConversationMessage {
    ConversationMessage(
      id: id,
      workspaceID: "workspace",
      conversationID: "mission-control",
      threadRootID: nil,
      author: author,
      body: id,
      components: [],
      createdAt: Date(timeIntervalSince1970: TimeInterval(minute * 60)),
      sequence: minute
    )
  }
}
