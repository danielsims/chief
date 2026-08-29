import { Effect } from "effect";

import { updateChiefUserImage } from "@chief/auth/d1-users";

import { deleteImageAsset, uploadImageAsset } from "./attachments";
import { attempt } from "./effect";
import { publicOrigin } from "./relay-discovery";

export const routeProfileImage = Effect.fn("routeProfileImage")(function* (
  env: Env,
  request: Request,
  authenticatedRequest: Request,
  userId: string,
) {
  const key = `profiles/${userId}`;
  if (request.method === "DELETE") {
    const response = yield* attempt("relay.profile_image.delete", () =>
      deleteImageAsset(env, key),
    );
    yield* persistProfileImage(env, userId, null);
    return response;
  }

  const url = new URL(request.url);
  const response = yield* attempt("relay.profile_image.upload", () =>
    uploadImageAsset(
      env,
      authenticatedRequest,
      publicOrigin(request, url, env),
      key,
      `/v1/assets/profiles/${encodeURIComponent(userId)}`,
    ),
  );
  const uploaded = yield* attempt("relay.profile_image.decode", () =>
    response.clone().json<{ url: string }>(),
  );
  yield* persistProfileImage(env, userId, uploaded.url);
  return response;
});

function persistProfileImage(env: Env, userId: string, image: string | null) {
  return attempt("relay.profile_image.persist", () =>
    updateChiefUserImage(env.AUTH_DB, { userId, image }),
  );
}
