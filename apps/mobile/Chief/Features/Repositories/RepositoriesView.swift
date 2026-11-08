import SwiftUI

struct RepositoriesView: View {
  private enum Filter: CaseIterable {
    case all, repositories, agents

    var label: String {
      switch self {
      case .all: "All repositories"
      case .repositories: "Repositories"
      case .agents: "Agents' repositories"
      }
    }
  }

  @Environment(AppModel.self) private var model
  @State private var showsAddRepository = false
  @State private var search = ""
  @State private var filter = Filter.all

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("Repositories")
          .font(.system(size: 26, weight: .regular, design: .rounded))
          .tracking(-0.6)
        Spacer()
        Menu {
          Picker("Show", selection: $filter) {
            ForEach(Filter.allCases, id: \.self) { Text($0.label) }
          }
        } label: {
          PageBarIcon(systemName: "line.3.horizontal.decrease")
        }
        .accessibilityLabel("Filter repositories")
        Button {
          Haptics.medium()
          showsAddRepository = true
        } label: {
          PageBarIcon(systemName: "plus")
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add repository")
      }
      .frame(height: 34)
      .padding(.horizontal, ChiefTheme.pagePadding)
      .padding(.top, 16)
      if !projects.isEmpty {
        ChiefSearchField(prompt: "Search repositories", text: $search)
      }
      Group {
      if projects.isEmpty {
        EmptyRepositoriesView(showsAddRepository: $showsAddRepository)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .padding(ChiefTheme.pagePadding)
          .padding(.bottom, 60)
      } else {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            if filteredProjects.isEmpty {
              ContentUnavailableView("No matching repositories", systemImage: "magnifyingglass")
                .foregroundStyle(ChiefTheme.secondary)
            }
            ForEach(filteredProjects) { project in
              NavigationLink {
                RepositoryDetailView(project: project)
              } label: {
                RepositoryRow(project: project)
              }
              .buttonStyle(.plain)
              .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
            }
          }
          .padding(.horizontal, ChiefTheme.pagePadding)
          .padding(.bottom, ChiefTheme.pagePadding)
        }
        .refreshable { await model.hydrateWorkspace() }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .background(ChiefTheme.background)
    .toolbar(.hidden, for: .navigationBar)
    .sheet(isPresented: $showsAddRepository) {
      AddRepositorySheet()
    }
  }

  private var projects: [ProjectSummary] { model.workspace?.projects ?? [] }

  private var filteredProjects: [ProjectSummary] {
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
    return projects.filter { project in
      switch filter {
      case .all: true
      case .repositories: project.agentID == nil
      case .agents: project.agentID != nil
      }
    }.filter {
      query.isEmpty
        || $0.name.localizedCaseInsensitiveContains(query)
        || $0.repository.localizedCaseInsensitiveContains(query)
    }
  }
}

/// A repository row, as on desktop: where it lives and its branch.
private struct RepositoryRow: View {
  let project: ProjectSummary

  var body: some View {
    HStack(spacing: 12) {
      RepositoryMark(project: project, size: 40)
      VStack(alignment: .leading, spacing: 3) {
        Text(project.name)
          .font(.system(size: 15, weight: .medium))
        Text(project.canonicalRemoteURL ?? "Local-only repository")
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
      }
      .lineLimit(1)
      Spacer(minLength: 8)
      Label(project.defaultBranch, systemImage: "arrow.triangle.branch")
        .font(.system(size: 12))
        .foregroundStyle(ChiefTheme.secondary)
        .lineLimit(1)
    }
    .frame(minHeight: 62)
    .contentShape(Rectangle())
  }
}

private struct RepositoryDetailView: View {
  let project: ProjectSummary

  var body: some View {
    VStack(spacing: 0) {
      PageDetailBar(title: project.name)
      ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        RepositoryHeader(project: project)
        RepositoryToolbar(project: project)

        if let tree = project.repositoryTree {
          RepositoryDirectoryContent(project: project, tree: tree, path: "")
        } else {
          RepositoryUnavailableView(project: project)
        }
      }
      .padding(ChiefTheme.pagePadding)
      .padding(.bottom, 28)
      }
    }
    .background(ChiefTheme.background.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .background(InteractivePopEnabler())
  }
}

private struct RepositoryHeader: View {
  let project: ProjectSummary

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      RepositoryMark(project: project, size: 46)
      VStack(alignment: .leading, spacing: 5) {
        Text(project.name)
          .font(.system(size: 20, weight: .semibold))
        Text(project.cardDescription)
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 0)
    }
  }
}

private struct RepositoryToolbar: View {
  let project: ProjectSummary

  var body: some View {
    ChiefCard {
      VStack(spacing: 13) {
        HStack(spacing: 10) {
          Label(project.defaultBranch, systemImage: "arrow.triangle.branch")
            .font(.system(size: 14, weight: .medium))
          Spacer()
          Text(project.providerName)
            .font(.system(size: 13))
            .foregroundStyle(ChiefTheme.secondary)
        }
        Divider().overlay(ChiefTheme.line)
        HStack {
          Label(fileSummary, systemImage: "doc.on.doc")
          Spacer()
          if let url = project.externalRepositoryURL {
            Link(destination: url) {
              Label("Open repository", systemImage: "arrow.up.right")
            }
          }
        }
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
      }
    }
  }

  private var fileSummary: String {
    guard let count = project.repositoryFiles?.count else { return "Files unavailable" }
    return "\(count) \(count == 1 ? "file" : "files")"
  }
}

private struct RepositoryDirectoryContent: View {
  let project: ProjectSummary
  let tree: ProjectRepositoryTree
  let path: String

  private var directory: ProjectRepositoryDirectory { tree.directory(at: path) }

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      VStack(alignment: .leading, spacing: 9) {
        if !path.isEmpty {
          RepositoryBreadcrumb(path: path)
        }
        ChiefCard {
          LazyVStack(spacing: 0) {
            ForEach(Array(directory.entries.enumerated()), id: \.element.id) { index, entry in
              RepositoryEntryRow(project: project, tree: tree, entry: entry)
              if index < directory.entries.count - 1 {
                Divider().overlay(ChiefTheme.line)
              }
            }
          }
          .padding(-16)
        }
      }

      if let readme = directory.readme {
        READMECard(file: readme)
      }
    }
  }
}

private struct RepositoryEntryRow: View {
  let project: ProjectSummary
  let tree: ProjectRepositoryTree
  let entry: ProjectRepositoryEntry

  var body: some View {
    NavigationLink {
      switch entry.kind {
      case .directory:
        RepositoryDirectoryView(project: project, tree: tree, path: entry.path)
      case .file:
        RepositoryFileView(project: project, file: tree.file(at: entry.path))
      }
    } label: {
      HStack(spacing: 12) {
        Image(systemName: entry.kind == .directory ? "folder" : fileSymbol)
          .font(.system(size: 16))
          .foregroundStyle(entry.kind == .directory ? ChiefTheme.channelAccent : ChiefTheme.secondary)
          .frame(width: 22)
        Text(entry.name)
          .font(.system(size: 14, weight: entry.kind == .directory ? .medium : .regular))
          .foregroundStyle(.primary)
          .lineLimit(1)
        Spacer(minLength: 8)
        if let size = entry.size {
          Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
            .font(.system(size: 11))
            .foregroundStyle(ChiefTheme.tertiary)
        }
        Image(systemName: "chevron.right")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(ChiefTheme.tertiary)
      }
      .padding(.horizontal, 15)
      .padding(.vertical, 13)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }

  private var fileSymbol: String {
    switch (entry.name as NSString).pathExtension.lowercased() {
    case "md": "doc.richtext"
    case "png", "jpg", "jpeg", "gif", "webp": "photo"
    case "json", "swift", "ts", "tsx", "js", "jsx", "css", "html", "yml", "yaml":
      "chevron.left.forwardslash.chevron.right"
    default: "doc"
    }
  }
}

private struct RepositoryDirectoryView: View {
  let project: ProjectSummary
  let tree: ProjectRepositoryTree
  let path: String

  var body: some View {
    VStack(spacing: 0) {
      PageDetailBar(title: (path as NSString).lastPathComponent)
      ScrollView {
        RepositoryDirectoryContent(project: project, tree: tree, path: path)
          .padding(ChiefTheme.pagePadding)
          .padding(.bottom, 28)
      }
    }
    .background(ChiefTheme.background.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .background(InteractivePopEnabler())
  }
}

private struct RepositoryFileView: View {
  let project: ProjectSummary
  let file: ProjectRepositorySourceFile?

  var body: some View {
    VStack(spacing: 0) {
      PageDetailBar(title: file.map { ($0.path as NSString).lastPathComponent } ?? project.name) {
        if let file {
          ShareLink(item: file.content) {
            PageBarIcon(systemName: "square.and.arrow.up")
          }
        }
      }
      ScrollView(.vertical) {
      if let file {
        ScrollView(.horizontal, showsIndicators: true) {
          Text(file.content)
            .font(.system(size: 12.5, design: .monospaced))
            .textSelection(.enabled)
            .padding(ChiefTheme.pagePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
          .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        ContentUnavailableView("File unavailable", systemImage: "doc.questionmark")
          .padding(40)
      }
    }
    }
    .background(ChiefTheme.background.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .background(InteractivePopEnabler())
  }
}

private struct READMECard: View {
  let file: ProjectRepositorySourceFile

  var body: some View {
    ChiefCard {
      VStack(alignment: .leading, spacing: 14) {
        Label((file.path as NSString).lastPathComponent, systemImage: "book.closed")
          .font(.system(size: 14, weight: .semibold))
        Divider().overlay(ChiefTheme.line)
        MarkdownMessageBody(source: file.content, channelNames: [])
      }
    }
  }
}

private struct RepositoryBreadcrumb: View {
  let path: String

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        Image(systemName: "folder")
        ForEach(Array(path.split(separator: "/").enumerated()), id: \.offset) { _, component in
          Image(systemName: "chevron.right")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(ChiefTheme.tertiary)
          Text(String(component))
        }
      }
      .font(.system(size: 13, weight: .medium))
      .foregroundStyle(ChiefTheme.secondary)
    }
  }
}

private struct RepositoryUnavailableView: View {
  let project: ProjectSummary

  var body: some View {
    ChiefCard {
      VStack(spacing: 11) {
        Image(systemName: "externaldrive.badge.questionmark")
          .font(.system(size: 25))
          .foregroundStyle(ChiefTheme.secondary)
        Text("Repository files unavailable")
          .font(.system(size: 16, weight: .semibold))
        Text("Chief can show this repository after its Git provider shares the files with the relay.")
          .font(.system(size: 13))
          .foregroundStyle(ChiefTheme.secondary)
          .multilineTextAlignment(.center)
        if let url = project.externalRepositoryURL {
          Link("Open repository", destination: url)
            .font(.system(size: 14, weight: .medium))
        }
      }
      .frame(maxWidth: .infinity)
      .padding(.vertical, 14)
    }
  }
}

/// A repository's icon: its own app icon from a desktop checkout, else its
/// GitHub owner's avatar or its Git host's icon, then the agent that keeps it,
/// and the folder desktop uses when none resolve.
private struct RepositoryMark: View {
  @Environment(AppModel.self) private var model
  @Environment(\.agentAvatars) private var agentAvatars
  @State private var imageStore = IdentityImageStore.shared
  let project: ProjectSummary
  var size: CGFloat = 42

  private var projectIcon: Data? { model.projectIcons[project.id] }
  private var projectIconKey: String {
    "project-icon|\(project.id)|\(projectIcon.map { "\($0.count)|\($0.hashValue)" } ?? "")"
  }

  var body: some View {
    Group {
      if let image = imageStore.image(for: projectIconKey) ?? imageStore.image(for: project.id) {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
          .frame(width: size, height: size)
          .background(ChiefTheme.elevated)
          .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
          .overlay {
            RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
              .stroke(ChiefTheme.line)
          }
      } else if let avatar = project.agentID.flatMap({ agentAvatars[$0] }) {
        AgentAvatarView(avatar: avatar, size: size)
      } else {
        Image(systemName: "folder")
          .font(.system(size: size * 0.4, weight: .regular))
          .foregroundStyle(.primary)
          .frame(width: size, height: size)
          .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
          .overlay {
            RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
              .stroke(ChiefTheme.line)
          }
      }
    }
    .task(id: projectIconKey) {
      if let projectIcon, imageStore.load(key: projectIconKey, data: projectIcon) { return }
      await imageStore.load(key: project.id, candidates: project.iconCandidates)
    }
  }
}

private struct EmptyRepositoriesView: View {
  @Binding var showsAddRepository: Bool

  var body: some View {
    ChiefCard {
      VStack(spacing: 12) {
        Image(systemName: "folder")
          .font(.system(size: 26))
          .foregroundStyle(ChiefTheme.secondary)
        Text("No repositories yet")
          .font(.system(size: 17, weight: .semibold))
        Text("Add a repository on Chief Git or GitHub.")
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
          .multilineTextAlignment(.center)
        Button("Add repository") { showsAddRepository = true }
          .buttonStyle(.borderedProminent)
          .tint(ChiefTheme.primary)
          .foregroundStyle(ChiefTheme.onPrimary)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding(.vertical, 22)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
