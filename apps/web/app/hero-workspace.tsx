import { MatrixLoader } from "@chief/ui/components/matrix-loader";

import { BrandMark } from "./brand-mark";
import { LandingAppShell } from "./landing-app-shell";

const agentWork = [
  ["Tomorrow", "9:00 am", "Review release branch", "Engineer"],
  ["Thu", "10:00 am", "Synthesize interviews", "Researcher"],
  ["Fri", "3:00 pm", "Weekly performance brief", "Analyst"],
] as const;

const trafficPoints = [
  [2, 37],
  [18, 33],
  [34, 35],
  [50, 26],
  [66, 29],
  [82, 21],
  [98, 24],
  [114, 17],
  [130, 20],
  [146, 13],
  [162, 15],
  [178, 8],
  [194, 11],
  [210, 4],
] as const;

const trafficPath = trafficPoints
  .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
  .join(" ");

function TrafficChart() {
  return (
    <div className="landing-traffic-chart" aria-hidden="true">
      <svg viewBox="0 0 212 43" preserveAspectRatio="none">
        <defs>
          <linearGradient id="landing-traffic-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.13" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="landing-traffic-area"
          d={`${trafficPath} L 210 43 L 2 43 Z`}
        />
        <path className="landing-traffic-line" d={trafficPath} pathLength="1" />
        <line
          className="landing-traffic-cursor"
          x1="178"
          x2="178"
          y1="3"
          y2="43"
        />
        <circle className="landing-traffic-dot-halo" cx="178" cy="8" r="3.5" />
        <circle className="landing-traffic-dot" cx="178" cy="8" r="1.6" />
      </svg>
      <span className="landing-traffic-tooltip">
        <small>13 Aug</small>
        <strong>
          <i>Active users</i>
          <b>742</b>
        </strong>
      </span>
    </div>
  );
}

export function HeroWorkspace() {
  return (
    <LandingAppShell
      activeNav="Overview"
      label="Chief desktop app overview with engineering, research and analytics agents at work"
    >
      <div className="landing-overview">
        <header className="landing-overview-heading">
          <div>
            <h3>Good evening, Sophie</h3>
            <p>An overview of your channels and agents.</p>
          </div>
          <span className="landing-overview-chief">
            <BrandMark size={13} />
            Chief
          </span>
        </header>

        <div className="landing-overview-grid">
          <article className="landing-focus-card landing-learning-card">
            <MatrixLoader
              ariaLabel="Chief is learning"
              className="landing-learning-spinner"
              fps={7}
              size={15}
            />
            <h4>Chief is learning your business.</h4>
            <p>
              Chief is reviewing your website, saved context and connected
              sources. You can leave this open; the work will continue.
            </p>
            <button type="button">View schedule&nbsp; →</button>
          </article>

          <article className="landing-traffic-card">
            <h4>Traffic is up 12.8% this month.</h4>
            <p>
              <strong>18.4K</strong> active users <span>↗ 12.8%</span>
            </p>
            <TrafficChart />
            <footer className="landing-traffic-pagination" aria-hidden="true">
              <span className="landing-traffic-arrow">‹</span>
              <span className="landing-traffic-page active" />
              <span className="landing-traffic-page" />
              <span className="landing-traffic-page" />
              <span className="landing-traffic-arrow">›</span>
            </footer>
          </article>

          <article className="landing-agent-work-card">
            <header>
              <span>Agent work</span>
              <span>View schedule&nbsp; →</span>
            </header>
            <div>
              {agentWork.map(([day, time, task, agent]) => (
                <span className="landing-agent-work-row" key={task}>
                  <span>
                    <strong>{day}</strong>
                    <small>{time}</small>
                  </span>
                  <i />
                  <span>
                    <strong>{task}</strong>
                    <small>Scheduled · {agent}</small>
                  </span>
                  <b>→</b>
                </span>
              ))}
            </div>
          </article>
        </div>

        <div className="landing-overview-composer">
          <div className="landing-overview-suggestions">
            <span>What should we focus on this week?</span>
            <span>Review the release plan</span>
            <span>Where are we losing momentum?</span>
          </div>
          <div className="landing-overview-input">
            <span>Message Chief...</span>
            <footer>
              <span>@</span>
              <span>⌕</span>
              <span>☻</span>
              <span>Aa</span>
              <button type="button">↑</button>
            </footer>
          </div>
        </div>
      </div>
    </LandingAppShell>
  );
}
