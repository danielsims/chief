import {
  buildGitRepository,
  gitUploadPackAdvertisement,
  gitUploadPackResult,
} from "@chief/agent-runtime/git-objects";

import { HttpError } from "./http";

export interface GitHttpFile {
  path: string;
  content: string;
}

export async function serveChiefGitHttp({
  files,
  operation,
  service,
  body,
}: {
  files: readonly GitHttpFile[];
  operation: "git-info-refs" | "git-upload-pack" | "git-receive-pack";
  service?: string | null;
  body?: Uint8Array;
}) {
  if (operation === "git-receive-pack") {
    throw new HttpError(
      403,
      "git_push_disabled",
      "Chief Git hosts the Eve agent directory for clone. Push is not enabled yet.",
    );
  }
  if (files.length === 0) {
    throw new HttpError(
      404,
      "git_repository_empty",
      "This Chief Git repository has not been published yet.",
    );
  }
  const repository = await buildGitRepository(
    files.map((file) => ({ path: file.path, content: file.content })),
  );
  if (operation === "git-info-refs") {
    if (service && service !== "git-upload-pack") {
      throw new HttpError(
        403,
        "git_service_unsupported",
        "Chief Git currently advertises git-upload-pack only.",
      );
    }
    return gitResponse(
      "application/x-git-upload-pack-advertisement",
      gitUploadPackAdvertisement(repository.commitSha),
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
