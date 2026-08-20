import XCTest

@testable import Chief

final class OpenCodeStreamingClientTests: XCTestCase {
  func testReassemblesReasoningContentAndFragmentedToolCalls() throws {
    var stream = OpenCodeStreamAccumulator()

    let firstReasoning = try stream.consume(event: event([
      "reasoning_content": "I should inspect "
    ]))
    let secondReasoning = try stream.consume(event: event([
      "reasoning_content": "the source.",
      "tool_calls": [[
        "index": 0,
        "id": "call-1",
        "function": ["name": "browser_", "arguments": #"{"url":"#],
      ]],
    ]))
    _ = try stream.consume(event: event([
      "tool_calls": [[
        "index": 0,
        "function": ["name": "navigate", "arguments": #""https://heychief.sh"}"#],
      ]]
    ]))

    XCTAssertEqual(firstReasoning, ["I should inspect "])
    XCTAssertEqual(secondReasoning, ["the source."])
    XCTAssertEqual(stream.toolCalls.count, 1)
    XCTAssertEqual(stream.toolCalls[0].id, "call-1")
    XCTAssertEqual(stream.toolCalls[0].function.name, "browser_navigate")
    XCTAssertEqual(
      stream.toolCalls[0].function.arguments,
      #"{"url":"https://heychief.sh"}"#
    )
  }

  func testReassemblesParallelToolsInProviderIndexOrder() throws {
    var stream = OpenCodeStreamAccumulator()
    _ = try stream.consume(event: event([
      "tool_calls": [
        [
          "index": 1,
          "id": "second",
          "function": ["name": "prospects_list", "arguments": "{}"],
        ],
        [
          "index": 0,
          "id": "first",
          "function": ["name": "brand_profile_get", "arguments": "{}"],
        ],
      ]
    ]))

    XCTAssertEqual(stream.toolCalls.map(\.id), ["first", "second"])
  }

  func testChiefDelegationCannotCallSpecialistOrBrowserTools() {
    let tools = AgentTurnToolPolicy.names(
      requiresChiefDelegation: true,
      attachedSkillIDs: []
    )

    XCTAssertTrue(tools.contains(RelayMessagePostTool.name))
    XCTAssertFalse(tools.contains(BrowserNavigateTool.name))
    XCTAssertFalse(tools.contains(BrandProfileSaveTool.name))
    XCTAssertFalse(tools.contains(ProspectSaveTool.name))
  }

  func testBrandSkillGetsOnlyItsResearchPersistenceSurface() {
    let tools = AgentTurnToolPolicy.names(
      requiresChiefDelegation: false,
      attachedSkillIDs: ["build-brand-profile"]
    )

    XCTAssertTrue(tools.contains(BrowserNavigateTool.name))
    XCTAssertTrue(tools.contains(BrandProfileSaveTool.name))
    XCTAssertFalse(tools.contains(ProspectSaveTool.name))
  }

  func testBrowserPolicyAllowsPublicHTTPSAndBlocksLocalTargets() throws {
    XCTAssertTrue(BrowserURLPolicy.allows(try XCTUnwrap(URL(string: "https://heychief.sh"))))
    XCTAssertFalse(BrowserURLPolicy.allows(try XCTUnwrap(URL(string: "http://heychief.sh"))))
    XCTAssertFalse(BrowserURLPolicy.allows(try XCTUnwrap(URL(string: "https://127.0.0.1"))))
    XCTAssertFalse(BrowserURLPolicy.allows(try XCTUnwrap(URL(string: "https://192.168.1.1"))))
    XCTAssertFalse(BrowserURLPolicy.allows(try XCTUnwrap(URL(string: "https://router.local"))))
    XCTAssertFalse(
      BrowserURLPolicy.allows(try XCTUnwrap(URL(string: "https://user:secret@example.com")))
    )
  }

  private func event(_ delta: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: ["choices": [["delta": delta]]])
  }
}
