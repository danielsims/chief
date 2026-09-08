import XCTest

@testable import Chief

final class ProjectRepositoryTreeTests: XCTestCase {
  func testBuildsSortedDirectoryEntriesWithoutLeakingNestedFiles() {
    let tree = ProjectRepositoryTree(files: [
      .init(path: "Sources/App.swift", content: "app"),
      .init(path: "README.md", content: "readme"),
      .init(path: "Sources/Features/Projects.swift", content: "projects"),
      .init(path: "Package.swift", content: "package"),
    ])

    let root = tree.directory()

    XCTAssertEqual(root.entries.map(\.name), ["Sources", "Package.swift", "README.md"])
    XCTAssertEqual(root.entries.map(\.kind), [.directory, .file, .file])
    XCTAssertEqual(root.readme?.content, "readme")
  }

  func testBrowsesNestedDirectoryAndLoadsFileContent() {
    let tree = ProjectRepositoryTree(files: [
      .init(path: "/Sources//App.swift", content: "app"),
      .init(path: "Sources/Features/Projects.swift", content: "projects"),
    ])

    let sources = tree.directory(at: "Sources")

    XCTAssertEqual(sources.entries.map(\.name), ["Features", "App.swift"])
    XCTAssertEqual(tree.file(at: "Sources/App.swift")?.content, "app")
  }

  func testProjectCardDescriptionNeverFallsBackToRemoteURL() {
    let project = ProjectSummary(
      id: "project-1",
      organizationID: "workspace-1",
      name: "chief",
      repositoryKind: "cloned",
      providerID: "github",
      canonicalRemoteURL: "https://github.com/danielsims/a-very-long-repository-url.git",
      defaultBranch: "main",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    )

    XCTAssertEqual(project.cardDescription, "Git repository")
  }
}
