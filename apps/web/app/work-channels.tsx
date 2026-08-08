import { BrandMark } from "./brand-mark";

const flowPaths = [
  "M 495 260 C 545 260, 555 65, 610 65",
  "M 495 260 C 545 260, 555 195, 610 195",
  "M 495 260 C 545 260, 555 325, 610 325",
  "M 495 260 C 545 260, 555 455, 610 455",
];

export function WorkChannels() {
  return (
    <div
      className="channel-flow"
      aria-label="A Chief result delivered to Slack, Claude, ChatGPT and Gmail"
    >
      <article className="flow-result">
        <header>
          <span>
            <BrandMark className="flow-chief-mark" size={18} tone="black" />
          </span>
          <div>
            <strong>Chief</strong>
            <small>Results from your workspace</small>
          </div>
        </header>
        <div className="flow-result-cycle">
          <div className="flow-result-item">
            <strong>Release review ready</strong>
            <p>The blocker is isolated. One decision is ready.</p>
          </div>
          <div className="flow-result-item">
            <strong>Customer signals ready</strong>
            <p>Seven interviews are synthesized into three themes.</p>
          </div>
          <div className="flow-result-item">
            <strong>Dependency check complete</strong>
            <p>Two follow-ups are ready for your approval.</p>
          </div>
        </div>
      </article>

      <svg
        className="flow-lines"
        aria-hidden="true"
        viewBox="0 0 1000 520"
        preserveAspectRatio="none"
      >
        {flowPaths.map((path, index) => (
          <g key={path}>
            <path d={path} />
            <circle className="flow-pulse" r="2.5">
              <animateMotion
                path={path}
                dur="6.4s"
                begin={`-${index * 1.35}s`}
                keyPoints="0;1"
                keyTimes="0;1"
                keySplines=".22 1 .36 1"
                calcMode="spline"
                repeatCount="indefinite"
              />
              <animate
                attributeName="r"
                values="2;3.8;2.7;4.2;2"
                keyTimes="0;0.64;0.8;0.9;1"
                dur="6.4s"
                begin={`-${index * 1.35}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;.75;0"
                keyTimes="0;.1;.8;.92;1"
                dur="6.4s"
                begin={`-${index * 1.35}s`}
                repeatCount="indefinite"
              />
            </circle>
          </g>
        ))}
      </svg>

      <div className="flow-destinations">
        <article className="flow-destination destination-slack">
          <header>
            <img src="https://integrations.sh/logo/slack.com" alt="" />
            <strong>#team-updates</strong>
          </header>
          <div className="slack-message">
            <span>
              <BrandMark
                className="channel-chief-mark"
                size={16}
                tone="black"
              />
            </span>
            <div>
              <p>
                <strong>Chief</strong>
                <i>APP</i>
                <time>9:41 AM</time>
              </p>
              <small>
                The weekly review is ready. The team moved four priorities and
                one decision needs you.
              </small>
            </div>
          </div>
        </article>

        <article className="flow-destination destination-claude">
          <header>
            <img src="https://integrations.sh/logo/claude.ai" alt="" />
            <strong>Claude</strong>
          </header>
          <div>
            <img src="https://integrations.sh/logo/claude.ai" alt="" />
            <p>
              I pulled the latest review from Chief. Four priorities moved this
              week and one decision is ready.
            </p>
          </div>
        </article>

        <article className="flow-destination destination-chatgpt">
          <header>
            <img src="https://integrations.sh/logo/chatgpt.com" alt="" />
            <strong>ChatGPT</strong>
          </header>
          <div>
            <p>Chief returned your weekly review with two actions ready.</p>
          </div>
        </article>

        <article className="flow-destination destination-gmail">
          <header>
            <img src="https://integrations.sh/logo/gmail.com" alt="" />
            <strong>Gmail</strong>
          </header>
          <div className="gmail-message">
            <span>
              <BrandMark
                className="channel-chief-mark"
                size={16}
                tone="black"
              />
            </span>
            <div>
              <b>Your weekly team digest</b>
              <p>
                <strong>Chief</strong>
                <time>9:41 AM</time>
              </p>
              <small>
                Four priorities moved. One decision is ready for review.
              </small>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
