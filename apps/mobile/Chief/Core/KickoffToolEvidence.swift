import Foundation

enum KickoffToolEvidence {
  static let specialistRequiredTools = Set([
    RelayChannelCreateTool.name,
    RelayWorkspaceMembersTool.name,
    RelayChannelMembersAddTool.name,
    RelayMessagePostTool.name,
  ])
  static let chiefRequiredTools = Set([
    RelayChannelMembersAddTool.name,
    RelayMessagePostTool.name,
  ])

  static func validate(
    components: [MessageComponent],
    jobKind: String,
    expectedThreadRootID: String? = nil
  ) throws {
    let requiredTools: Set<String>
    if jobKind == "workspace.onboarding" {
      requiredTools = chiefRequiredTools
    } else if jobKind.hasPrefix("workspace.kickoff.") {
      requiredTools = specialistRequiredTools
    } else {
      return
    }
    let completedTools = Set(
      components.compactMap { component -> String? in
        guard component.kind == "tool",
          component.payload["status"] == "completed"
        else { return nil }
        return component.payload["name"]
      }
    )
    guard requiredTools.isSubset(of: completedTools) else {
      throw WorkspaceSetupError.missingRequiredToolCalls
    }
    if jobKind == "workspace.onboarding" { try validateChiefDelegation(components) }
    // The relay independently verifies the actual specialist thread reply,
    // public channel, agent ownership and owner membership before accepting a
    // completion. Do not reject a genuine defaulted tool call by re-parsing the
    // model's optional JSON arguments on the phone.
  }

  private static func validateChiefDelegation(_ components: [MessageComponent]) throws {
    let completed = components.filter {
      $0.kind == "tool" && $0.payload["status"] == "completed"
    }
    let membershipCalls = completed.filter { component in
      guard component.payload["name"] == RelayChannelMembersAddTool.name,
        let input = component.payload["input"],
        let values = json(input)
      else { return false }
      return values["conversationId"] as? String == "mission-control"
        && values["kind"] as? String == "agent"
    }
    let invited = Set(membershipCalls.flatMap { component -> [String] in
      guard component.payload["name"] == RelayChannelMembersAddTool.name,
        let input = component.payload["input"],
        let values = json(input),
        values["conversationId"] as? String == "mission-control",
        values["kind"] as? String == "agent"
      else { return [] }
      if let principalIDs = values["principalIds"] as? [String] {
        return principalIDs
      }
      return (values["principalId"] as? String).map { [$0] } ?? []
    })
    let kickoffMentions = Set(completed.compactMap { component -> String? in
      guard component.payload["name"] == RelayMessagePostTool.name,
        let input = component.payload["input"],
        let values = json(input),
        values["conversationId"] as? String == "mission-control",
        let body = values["body"] as? String
      else { return nil }
      if body.localizedCaseInsensitiveContains("@Marketer") { return "brand" }
      if body.localizedCaseInsensitiveContains("@Prospector") { return "prospector" }
      if body.localizedCaseInsensitiveContains("@Engineer") { return "engineer" }
      return nil
    })
    let expected = Set(["brand", "prospector", "engineer"])
    let missionControlPosts = completed.filter { component in
      guard component.payload["name"] == RelayMessagePostTool.name,
        let input = component.payload["input"],
        let values = json(input)
      else { return false }
      return values["conversationId"] as? String == "mission-control"
    }
    guard membershipCalls.count == 1,
      expected.isSubset(of: invited),
      expected.isSubset(of: kickoffMentions),
      missionControlPosts.count >= 4
    else {
      throw WorkspaceSetupError.missingRequiredToolCalls
    }
  }

  private static func json(_ source: String) -> [String: Any]? {
    guard let data = source.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  }
}
