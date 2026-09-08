import Foundation

struct ProjectRepositoryEntry: Equatable, Identifiable, Sendable {
  enum Kind: Int, Equatable, Sendable {
    case directory
    case file
  }

  let name: String
  let path: String
  let kind: Kind
  let size: Int?

  var id: String { path }
}

struct ProjectRepositoryDirectory: Equatable, Sendable {
  let path: String
  let entries: [ProjectRepositoryEntry]
  let readme: ProjectRepositorySourceFile?
}

struct ProjectRepositoryTree: Equatable, Sendable {
  let files: [ProjectRepositorySourceFile]

  init(files: [ProjectRepositorySourceFile]) {
    self.files = files.compactMap { file in
      let path = Self.normalize(file.path)
      return path.isEmpty ? nil : ProjectRepositorySourceFile(path: path, content: file.content)
    }
  }

  func directory(at requestedPath: String = "") -> ProjectRepositoryDirectory {
    let path = Self.normalize(requestedPath)
    let prefix = path.isEmpty ? "" : "\(path)/"
    var entries: [String: ProjectRepositoryEntry] = [:]

    for file in files where file.path.hasPrefix(prefix) {
      let relativePath = String(file.path.dropFirst(prefix.count))
      let components = relativePath.split(separator: "/", omittingEmptySubsequences: true)
      guard let first = components.first else { continue }
      let name = String(first)
      let entryPath = prefix + name
      if components.count > 1 {
        entries[name] = ProjectRepositoryEntry(
          name: name,
          path: entryPath,
          kind: .directory,
          size: nil
        )
      } else {
        entries[name] = ProjectRepositoryEntry(
          name: name,
          path: entryPath,
          kind: .file,
          size: file.content.utf8.count
        )
      }
    }

    let readme = files.first { file in
      let parent = (file.path as NSString).deletingLastPathComponent
      return Self.normalize(parent) == path
        && (file.path as NSString).lastPathComponent.lowercased() == "readme.md"
    }

    return ProjectRepositoryDirectory(
      path: path,
      entries: entries.values.sorted { left, right in
        if left.kind != right.kind { return left.kind.rawValue < right.kind.rawValue }
        return left.name.localizedStandardCompare(right.name) == .orderedAscending
      },
      readme: readme
    )
  }

  func file(at requestedPath: String) -> ProjectRepositorySourceFile? {
    let path = Self.normalize(requestedPath)
    return files.first { $0.path == path }
  }

  private static func normalize(_ path: String) -> String {
    path
      .split(separator: "/", omittingEmptySubsequences: true)
      .filter { $0 != "." && $0 != ".." }
      .joined(separator: "/")
  }
}

extension ProjectSummary {
  var repositoryTree: ProjectRepositoryTree? {
    guard let repositoryFiles, !repositoryFiles.isEmpty else { return nil }
    return ProjectRepositoryTree(files: repositoryFiles)
  }

  var cardDescription: String {
    if let description = description?.trimmingCharacters(in: .whitespacesAndNewlines),
      !description.isEmpty
    {
      return description
    }
    return agentID == nil ? "Git repository" : "Agent repository"
  }

  var providerName: String {
    switch providerID {
    case "github": "GitHub"
    case "gitlab": "GitLab"
    case "bitbucket": "Bitbucket"
    case "chief-git": "Chief Git"
    case "local": "Local"
    default: "Git"
    }
  }

  var externalRepositoryURL: URL? {
    let value = repositoryWebURL ?? canonicalRemoteURL
    return value.flatMap(URL.init(string:))
  }
}
