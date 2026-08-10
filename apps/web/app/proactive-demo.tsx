"use client";

import { BrandMark } from "./brand-mark";

function RecurringCard({
  title,
  meta,
  result,
  approval,
}: {
  title: string;
  meta: string;
  result?: string;
  approval?: boolean;
}) {
  return (
    <div className="recurring-card">
      <div>
        <i />
        <p>
          <strong>{title}</strong>
          <span>{meta}</span>
        </p>
      </div>
      {result ? <p>{result}</p> : null}
      {approval ? (
        <button type="button">Review run</button>
      ) : (
        <footer>
          <button type="button">Run now</button>
          <button type="button">Pause</button>
          <span>
            Runs on <b>This Mac</b>
            <b>Cloud</b>
          </span>
        </footer>
      )}
    </div>
  );
}

function ChiefNotificationMark() {
  return (
    <span className="notification-mark">
      <BrandMark className="notification-brand-mark" size={22} tone="black" />
    </span>
  );
}

export function ProactiveDemo() {
  return (
    <div className="proactive-demo">
      <div className="proactive-schedule">
        <header>
          <strong>Recurring work</strong>
          <button type="button">New recurring work</button>
        </header>
        <RecurringCard
          title="Weekly performance review"
          meta="analyst · needs approval"
          result="Customer activation increased 18%. Two actions are ready for review."
          approval
        />
        <RecurringCard title="Dependency scan" meta="operations · active" />
      </div>
      <div className="proactive-notification">
        <ChiefNotificationMark />
        <div className="notification-copy">
          <div className="notification-app">
            <strong>Chief</strong>
            <time>now</time>
          </div>
          <b>Your weekly review is ready</b>
          <p>Customer activation is up 18%. Two actions need your approval.</p>
        </div>
      </div>
    </div>
  );
}
