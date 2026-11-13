import type { ReactNode } from "react";

import {
  HandoffCard,
  HandoffHeading,
  handoffPrimaryClassName,
} from "./handoff-card";

/** The browser handoff after signing in, shared by web and desktop development. */
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
    <HandoffCard brand={brand}>
      <HandoffHeading
        done={success}
        title={
          success ? <>You&rsquo;re in</> : <>Sign-in didn&rsquo;t finish</>
        }
      >
        {success
          ? "Chief is opening now. You can close this tab."
          : error
            ? "Return to Chief and try signing in again."
            : "Chief didn’t receive a complete sign-in response. Return to the app and try again."}
      </HandoffHeading>
      {returnHref ? (
        <a href={returnHref} className={handoffPrimaryClassName}>
          {success ? "Open Chief" : "Return to Chief"}
        </a>
      ) : null}
    </HandoffCard>
  );
}
