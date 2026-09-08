// Run against the proposed commit; --hide-all preserves unfinished local work.
export default () => [
  "pnpm lint",
  "pnpm typecheck",
  "node tooling/scripts/format-staged.mjs",
];
