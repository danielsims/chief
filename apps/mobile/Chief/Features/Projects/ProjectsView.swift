import SwiftUI

struct ProjectsView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if projects.isEmpty { EmptyProjectsView() }
                ForEach(projects) { project in
                    NavigationLink { ProjectDetailView(project: project) } label: {
                        ProjectCard(project: project)
                    }
                    .buttonStyle(.plain)
                    .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
                }
            }.padding(ChiefTheme.pagePadding)
        }
        .background(ChiefTheme.background)
        .navigationTitle("Projects")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Haptics.medium()
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
    }
    private var projects: [ProjectSummary] { model.workspace?.projects ?? [] }
}

private struct ProjectCard: View {
    let project: ProjectSummary
    var body: some View {
        ChiefCard {
            HStack(spacing: 13) {
                Image("ChiefMark").resizable().scaledToFit().frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 5) {
                    Text(project.name).font(.system(size: 16, weight: .semibold))
                    Text(project.repository).font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
                    HStack(spacing: 12) {
                        Label(project.branch, systemImage: "arrow.triangle.branch").lineLimit(1)
                        if project.changedFiles > 0 { Text("\(project.changedFiles) changed") }
                    }.font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(ChiefTheme.tertiary)
            }
        }
    }
}

private struct ProjectDetailView: View {
    let project: ProjectSummary
    private let files = ["apps", "packages", "tooling", "README.md", "package.json", "pnpm-lock.yaml"]
    var body: some View {
        List {
            Section {
                HStack { Label(project.branch, systemImage: "arrow.triangle.branch").lineLimit(1); Spacer(); Image(systemName: "chevron.down") }
                HStack { Label("12 branches", systemImage: "arrow.triangle.branch"); Spacer(); Label("331 commits", systemImage: "clock.arrow.circlepath") }
            }
            Section("Files") {
                ForEach(files, id: \.self) { file in
                    HStack { Image(systemName: file.contains(".") ? "doc" : "folder").foregroundStyle(ChiefTheme.secondary); Text(file); Spacer(); Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(ChiefTheme.tertiary) }
                }
            }
            Section("README") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Chief").font(.system(size: 26, weight: .semibold, design: .rounded))
                    Text("The agent workspace for running a company.").font(.system(size: 15)).foregroundStyle(ChiefTheme.secondary)
                }.padding(.vertical, 8)
            }
        }
        .scrollContentBackground(.hidden)
        .background(ChiefTheme.background)
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct EmptyProjectsView: View {
    var body: some View {
        ChiefCard {
            VStack(spacing: 12) {
                Image(systemName: "shippingbox").font(.system(size: 26)).foregroundStyle(ChiefTheme.secondary)
                Text("Connect a Git repository").font(.system(size: 17, weight: .semibold))
                Text("Projects keep code, branches, and reviews in the workspace.").font(.system(size: 14)).foregroundStyle(ChiefTheme.secondary).multilineTextAlignment(.center)
                Button("Add project", action: {}).buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
            }.frame(maxWidth: .infinity).padding(.vertical, 22)
        }
    }
}
