import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { buttonVariants } from "./button";
import { SuccessCheck } from "./success-check";

/** The browser handoff screen shared by web sign-in and desktop development. */
export function DesktopAuthResult({
  success,
  brand,
  returnHref,
  error,
}: {
  success: boolean;
  brand: ReactNode;
  returnHref?: string;
  error?: boolean;
}) {
  return (
    <main className="bg-background text-foreground flex min-h-screen w-full flex-col">
      <header className="px-6 pt-6">{brand}</header>
      <div className="flex flex-1 items-center justify-center px-8 pb-20">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
          {success ? <SuccessCheck className="mb-6 size-16" /> : null}
          <div
            className={cn(
              "flex w-full flex-col items-center",
              success && "success-copy",
            )}
          >
            <h1 className="text-3xl leading-tight font-normal">
              {success ? (
                <>You&rsquo;re in.</>
              ) : (
                <>Sign-in didn&rsquo;t finish.</>
              )}
            </h1>
            <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
              {success
                ? "Chief is opening now. You can close this tab."
                : error
                  ? "Return to Chief and try signing in again."
                  : "Chief didn’t receive a complete sign-in response. Return to the app and try again."}
            </p>
            {returnHref ? (
              <a
                href={returnHref}
                className={cn(
                  buttonVariants({ variant: success ? "default" : "outline" }),
                  "mt-8 h-11 w-full",
                )}
              >
                {success ? "Open Chief" : "Return to Chief"}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
