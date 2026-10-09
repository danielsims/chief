import type { GitRef, GitRepository } from "@chief/agent-runtime/git-objects";
import {
  gitUploadPackAdvertisementForRefs,
  gitUploadPackResult,
} from "@chief/agent-runtime/git-objects";

import { HttpError } from "./http";

export async function serveWorkspaceGitHttp({
  repository,
  refs,
  operation,
  service,
  body,
}: {
  repository: GitRepository;
  refs: readonly GitRef[];
  operation: "git-info-refs" | "git-upload-pack" | "git-receive-pack";
  service?: string | null;
  body?: Uint8Array;
}) {
  if (operation === "git-receive-pack") {
    throw new HttpError(
      403,
      "git_push_disabled",
      "The workspace Git host accepts changes through its publish tool, not the Git wire push protocol.",
    );
  }
  if (refs.length === 0) {
    throw new HttpError(
      404,
      "git_repository_empty",
      "This workspace Git repository has not been published yet.",
    );
  }
  if (operation === "git-info-refs") {
    if (service && service !== "git-upload-pack") {
      throw new HttpError(
        403,
        "git_service_unsupported",
        "The workspace Git host currently advertises git-upload-pack only.",
      );
    }
    return gitResponse(
      "application/x-git-upload-pack-advertisement",
      gitUploadPackAdvertisementForRefs(refs),
    );
  }
  return gitResponse(
    "application/x-git-upload-pack-result",
    await gitUploadPackResult(repository, body ?? new Uint8Array()),
  );
}

function gitResponse(contentType: string, body: Uint8Array) {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  // Safe because `copy` is a standalone Uint8Array whose backing store is an ArrayBuffer.
  return new Response(copy.buffer, {
    headers: {
      "cache-control": "no-cache, max-age=0, must-revalidate",
      "content-type": contentType,
    },
  });
}
