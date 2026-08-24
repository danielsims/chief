import path from "node:path";

const workspaceDirectories = [
  "apps/desktop",
  "apps/relay",
  "apps/web",
  "apps/workspace",
  "packages/agent-runtime",
  "packages/backend",
  "packages/email",
  "packages/ui",
];

const quote = (value) => JSON.stringify(value);

function formatFiles(files) {
  return `prettier --write --ignore-unknown ${files.map(quote).join(" ")}`;
}

function lintWorkspaceFiles(files) {
  const root = process.cwd();

  return workspaceDirectories.flatMap((directory) => {
    const workspaceRoot = path.join(root, directory);
    const workspaceFiles = files
      .filter((file) => file.startsWith(`${workspaceRoot}${path.sep}`))
      .map((file) => path.relative(workspaceRoot, file));

    if (workspaceFiles.length === 0) return [];

    return `pnpm --dir ${quote(directory)} exec eslint --flag unstable_native_nodejs_ts_config --fix --no-warn-ignored ${workspaceFiles.map(quote).join(" ")}`;
  });
}

export default {
  "*": formatFiles,
  "*.{cjs,js,jsx,mjs,ts,tsx}": lintWorkspaceFiles,
};
