import SwiftUI

struct ProjectsView: View {
  @Environment(AppModel.self) private var model
  @State private var showsAddProject = false

  var body: some View {
    Group {
      if projects.isEmpty {
        EmptyProjectsView(showsAddProject: $showsAddProject)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .padding(ChiefTheme.pagePadding)
          .padding(.bottom, 60)
      } else {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 12) {
            ForEach(projects) { project in
              NavigationLink {
                ProjectDetailView(project: project)
              } label: {
                ProjectCard(project: project)
              }
              .buttonStyle(.plain)
              .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
            }
          }
          .padding(ChiefTheme.pagePadding)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ChiefTheme.background)
    .navigationTitle("Projects")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          Haptics.medium()
          showsAddProject = true
        } label: {
          Image(systemName: "plus")
        }
      }
    }
    .sheet(isPresented: $showsAddProject) {
      AddProjectSheet()
    }
  }

  private var projects: [ProjectSummary] { model.workspace?.projects ?? [] }
}

private struct ProjectCard: View {
  let project: ProjectSummary

  var body: some View {
    ChiefCard {
      HStack(alignment: .top, spacing: 13) {
        RepositoryMark()
        VStack(alignment: .leading, spacing: 7) {
          Text(project.name)
            .font(.system(size: 16, weight: .semibold))
            .lineLimit(1)
          Text(project.cardDescription)
            .font(.system(size: 13))
            .foregroundStyle(ChiefTheme.secondary)
            .lineLimit(2)
          HStack(spacing: 12) {
            Label(project.defaultBranch, systemImage: "arrow.triangle.branch")
            Label(project.providerName, systemImage: "chevron.left.forwardslash.chevron.right")
            if let count = project.repositoryFiles?.count {
              Text("\(count) \(count == 1 ? "file" : "files")")
            }
          }
          .font(.system(size: 12))
          .foregroundStyle(ChiefTheme.secondary)
          .lineLimit(1)
        }
        Spacer(minLength: 4)
        Image(systemName: "chevron.right")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(ChiefTheme.tertiary)
          .padding(.top, 5)
      }
    }
  }
}

private struct ProjectDetailView: View {
  let project: ProjectSummary

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        ProjectHeader(project: project)
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
    .background(ChiefTheme.background)
    .navigationTitle(project.name)
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct ProjectHeader: View {
  let project: ProjectSummary

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      RepositoryMark(size: 46)
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
        ProjectDirectoryView(project: project, tree: tree, path: entry.path)
      case .file:
        ProjectFileView(project: project, file: tree.file(at: entry.path))
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

private struct ProjectDirectoryView: View {
  let project: ProjectSummary
  let tree: ProjectRepositoryTree
  let path: String

  var body: some View {
    ScrollView {
      RepositoryDirectoryContent(project: project, tree: tree, path: path)
        .padding(ChiefTheme.pagePadding)
        .padding(.bottom, 28)
    }
    .background(ChiefTheme.background)
    .navigationTitle((path as NSString).lastPathComponent)
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct ProjectFileView: View {
  let project: ProjectSummary
  let file: ProjectRepositorySourceFile?

  var body: some View {
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
    .background(ChiefTheme.background)
    .navigationTitle(file.map { ($0.path as NSString).lastPathComponent } ?? project.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if let file {
        ToolbarItem(placement: .topBarTrailing) {
          ShareLink(item: file.content) {
            Image(systemName: "square.and.arrow.up")
          }
        }
      }
    }
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
        Image(systemName: "shippingbox")
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

private struct RepositoryMark: View {
  var size: CGFloat = 42

  var body: some View {
    Image(systemName: "shippingbox")
      .font(.system(size: size * 0.42, weight: .medium))
      .foregroundStyle(.primary)
      .frame(width: size, height: size)
      .background(ChiefTheme.elevated, in: RoundedRectangle(cornerRadius: size * 0.24))
      .overlay {
        RoundedRectangle(cornerRadius: size * 0.24)
          .stroke(ChiefTheme.line)
      }
  }
}

private struct EmptyProjectsView: View {
  @Binding var showsAddProject: Bool

  var body: some View {
    ChiefCard {
      VStack(spacing: 12) {
        Image(systemName: "shippingbox")
          .font(.system(size: 26))
          .foregroundStyle(ChiefTheme.secondary)
        Text("Connect a Git repository")
          .font(.system(size: 17, weight: .semibold))
        Text("Projects keep code, branches, and reviews in the workspace.")
          .font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary)
          .multilineTextAlignment(.center)
        Button("Add project") { showsAddProject = true }
          .buttonStyle(.borderedProminent)
          .tint(.white)
          .foregroundStyle(.black)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding(.vertical, 22)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
