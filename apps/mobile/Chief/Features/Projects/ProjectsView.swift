import SwiftUI

struct ProjectsView: View {
  @Environment(AppModel.self) private var model
  var body: some View {
    Group {
      if projects.isEmpty {
        EmptyProjectsView()
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .padding(ChiefTheme.pagePadding)
          .padding(.bottom, 60)
      } else {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(projects) { project in
              NavigationLink {
                ProjectDetailView(project: project)
              } label: {
                ProjectCard(project: project)
              }
              .buttonStyle(.plain)
              .simultaneousGesture(TapGesture().onEnded { Haptics.medium() })
            }
          }.padding(ChiefTheme.pagePadding)
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
        Image("ChiefMark").resizable().scaledToFit().frame(width: 40, height: 40).clipShape(
          RoundedRectangle(cornerRadius: 9))
        VStack(alignment: .leading, spacing: 5) {
          Text(project.name).font(.system(size: 16, weight: .semibold))
          Text(project.repository).font(.system(size: 13)).foregroundStyle(ChiefTheme.secondary)
          HStack(spacing: 12) {
            Label(project.branch, systemImage: "arrow.triangle.branch").lineLimit(1)
            if project.changedFiles > 0 { Text("\(project.changedFiles) changed") }
          }.font(.system(size: 12)).foregroundStyle(ChiefTheme.secondary)
        }
        Spacer()
        Image(systemName: "chevron.right").font(.system(size: 12)).foregroundStyle(
          ChiefTheme.tertiary)
      }
    }
  }
}

private struct ProjectDetailView: View {
  let project: ProjectSummary
  var body: some View {
    List {
      Section {
        LabeledContent("Repository", value: project.repository)
        LabeledContent("Default branch", value: project.defaultBranch)
        LabeledContent("Provider", value: project.providerID)
        if let description = project.description, !description.isEmpty {
          Text(description).foregroundStyle(ChiefTheme.secondary)
        }
      }
      Section {
        Text(
          "Repository contents appear after this device or an agent cell materializes the project."
        )
        .font(.system(size: 13))
        .foregroundStyle(ChiefTheme.secondary)
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
        Image(systemName: "shippingbox").font(.system(size: 26)).foregroundStyle(
          ChiefTheme.secondary)
        Text("Connect a Git repository").font(.system(size: 17, weight: .semibold))
        Text("Projects keep code, branches, and reviews in the workspace.").font(.system(size: 14))
          .foregroundStyle(ChiefTheme.secondary).multilineTextAlignment(.center)
        Button("Add project", action: {}).buttonStyle(.borderedProminent).tint(.white)
          .foregroundStyle(.black)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding(.vertical, 22)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
