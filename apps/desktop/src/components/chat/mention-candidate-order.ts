export function orderMentionCandidatesByMembership<
  Candidate extends { member: boolean },
>(candidates: readonly Candidate[]): Candidate[] {
  return [
    ...candidates.filter((candidate) => candidate.member),
    ...candidates.filter((candidate) => !candidate.member),
  ];
}
