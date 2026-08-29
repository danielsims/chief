const quote = (value) => JSON.stringify(value);

function formatFiles(files) {
  return `prettier --write --ignore-unknown ${files.map(quote).join(" ")}`;
}

function lintFiles(files) {
  return `oxlint --fix --no-error-on-unmatched-pattern ${files.map(quote).join(" ")}`;
}

export default {
  "*": formatFiles,
  "*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}": lintFiles,
};
