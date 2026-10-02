import { Suspense } from "react";

import { readSignInContext } from "../../lib/sign-in-context";
import { SignInContent } from "./sign-in-content";

export default async function SignInPage() {
  const initial = await readSignInContext();
  return (
    <Suspense fallback={<main className="bg-background min-h-screen" />}>
      <SignInContent initial={initial} />
    </Suspense>
  );
}
