import { BrandMark } from "./brand-mark";

const flowPaths = [
  "M 495 260 C 545 260, 555 65, 610 65",
  "M 495 260 C 545 260, 555 195, 610 195",
  "M 495 260 C 545 260, 555 325, 610 325",
  "M 495 260 C 545 260, 555 455, 610 455",
];

const mobileFlowPaths = [
  "M 19 0 L 19 160 L 54 160",
  "M 19 0 L 19 400 L 54 400",
  "M 19 0 L 19 640 L 54 640",
  "M 19 0 L 19 880 L 54 880",
];

const destinations = [
  {
    id: "slack",
    name: "Slack",
    detail: "#team-updates",
    status: "Posted",
    copy: "Four priorities moved. One decision needs you.",
    domain: "slack.com",
  },
  {
    id: "claude",
    name: "Claude",
    detail: "Workspace context",
    status: "Ready",
    copy: "Bring the latest Chief result into the conversation.",
    domain: "claude.ai",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    detail: "Connected app",
    status: "Ready",
    copy: "Ask with the useful workspace context already attached.",
    domain: "chatgpt.com",
  },
  {
    id: "gmail",
    name: "Gmail",
    detail: "Weekly digest",
    status: "Delivered",
    copy: "A calm summary arrives when results are ready.",
    domain: "gmail.com",
  },
] as const;

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
        className="flow-lines flow-lines-desktop"
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
                dur="4.2s"
                begin={`-${index * 1.05}s`}
                calcMode="linear"
                repeatCount="indefinite"
              />
              <animate
                attributeName="r"
                values="2;3.8;2.7;4.2;2"
                keyTimes="0;0.7;0.84;0.94;1"
                dur="4.2s"
                begin={`-${index * 1.05}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;.06;.94;1"
                dur="4.2s"
                begin={`-${index * 1.05}s`}
                repeatCount="indefinite"
              />
            </circle>
          </g>
        ))}
      </svg>

      <div className="flow-destinations">
        <svg
          className="flow-lines-mobile"
          aria-hidden="true"
          viewBox="0 0 100 1000"
          preserveAspectRatio="xMinYMin meet"
        >
          {mobileFlowPaths.map((path, index) => (
            <g key={path}>
              <path d={path} />
              <circle className="flow-pulse" r="2.4">
                <animateMotion
                  path={path}
                  dur="8s"
                  begin={`-${index * 2}s`}
                  keyPoints="0;1;1"
                  keyTimes="0;.25;1"
                  calcMode="linear"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;1;1;0;0"
                  keyTimes="0;.02;.23;.25;1"
                  dur="8s"
                  begin={`-${index * 2}s`}
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          ))}
        </svg>
        {destinations.map((destination) => (
          <article
            className={`flow-destination destination-${destination.id}`}
            key={destination.id}
          >
            <header>
              <span className="flow-destination-icon">
                <img
                  src={`https://integrations.sh/logo/${destination.domain}`}
                  alt=""
                />
              </span>
              <span className="flow-destination-name">
                <strong>{destination.name}</strong>
                <small>{destination.detail}</small>
              </span>
              <em>{destination.status}</em>
            </header>
            <p>{destination.copy}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
