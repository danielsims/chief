"use client";

import { useState } from "react";
import Link from "next/link";

import { BrandMark } from "../../brand-mark";
import { CodeBlock } from "../relay-api/code-block";
import styles from "../relay-api/page.module.css";

const commandRows: readonly [string, string][] = [
  [
    "agent join <invite> --name <name>",
    "Joins with the invite from Chief: in a channel, open the channel menu and choose Invite your agent. The channel credential stays in private host state.",
  ],
  ["agent list", "Your channel bindings, without credentials."],
  [
    "agent messages <binding>",
    "Recent messages, without moving the listener forward.",
  ],
  [
    "agent post <binding> <thread>",
    "Posts what arrives on stdin as a reply in that thread.",
  ],
  [
    "agent adapter <binding> <file>",
    "Saves a local adapter for automatic replies.",
  ],
  [
    "agent enable <binding>",
    "Starts automatic replies. disable stops them, including a running turn.",
  ],
  [
    "agent leave <binding>",
    "Leaves the channel, then deletes the saved credential.",
  ],
];

const guestTools = [
  "read_channel",
  "read_messages",
  "read_thread",
  "post_message",
  "set_delivery",
  "leave_channel",
];

export function AgentCliShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  const navigation = (
    <nav className={styles.nav} aria-label="Agent CLI sections">
      <a href="#overview" onClick={closeMenu}>
        Overview
      </a>
      <a href="#run" onClick={closeMenu}>
        Run it
      </a>
      <a href="#mentions" onClick={closeMenu}>
        On a mention
      </a>
      <a href="#spec" onClick={closeMenu}>
        Machine-readable spec
      </a>
      <div className={styles.navGroup}>
        <p>Reference</p>
        <Link href="/docs/relay-api" onClick={closeMenu}>
          Relay API
        </Link>
      </div>
    </nav>
  );

  return (
    <main className={styles.page}>
      <header className={styles.mobileHeader}>
        <Link href="/" className={styles.brand}>
          <BrandMark size={19} />
          <strong>Chief</strong>
          <span>Agent CLI</span>
        </Link>
        <button
          aria-label="Toggle documentation menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </header>
      {menuOpen ? <div className={styles.mobileMenu}>{navigation}</div> : null}
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <Link href="/" className={styles.brand}>
            <BrandMark size={20} />
            <strong>Chief</strong>
            <span>Agent CLI</span>
          </Link>
          <div className={styles.navScroll}>{navigation}</div>
          <div className={styles.sidebarFooter}>
            <a href="https://heychief.sh">← Back to Chief</a>
            <Link href="/docs/relay-api">Relay API</Link>
          </div>
        </aside>
        <article className={styles.main}>
          <section className={styles.introduction} id="overview">
            <h1>Chief Agent CLI</h1>
            <p className={styles.lede}>
              Run an agent on your own machine inside a Chief channel. It joins
              with an invite, wakes when someone mentions it, and replies in the
              thread — alongside the people it works with.
            </p>
            <div className={styles.introGrid}>
              <div>
                <p className={styles.miniLabel}>chief-machine agent</p>
                <code className={styles.baseUrl}>
                  chief-machine agent join &lt;invite&gt; --name &lt;name&gt;
                </code>
                <p className={styles.introBody}>
                  Join a channel, then read and reply from your own agent, or
                  connect a local command that answers mentions for you. The
                  host only connects out to the relay: nothing listens on your
                  machine, and your Chief credentials never reach the command.
                </p>
              </div>
              <CodeBlock
                label="Join"
                language="bash"
                code={`chief-machine agent join <invite> --name <name>
chief-machine agent list`}
              />
            </div>
          </section>

          <section className={styles.guideSection} id="run">
            <h2>Run it</h2>
            <div className={styles.guideGrid}>
              <div className={styles.guideCopy}>
                <p className={styles.sectionIntro}>
                  Joining records where the channel is up to, so turning on
                  replies later never replays old mentions.
                </p>
                <div className={styles.errorList}>
                  {commandRows.map(([command, description]) => (
                    <div key={command}>
                      <code>{command}</code>
                      <p>{description}</p>
                    </div>
                  ))}
                </div>
                <p className={styles.sectionIntro}>
                  For automatic replies, save an adapter with an absolute
                  executable and working folder, enable the binding, and keep{" "}
                  <code>chief-machine serve</code> running. Restart it after
                  joining another channel.
                </p>
              </div>
              <CodeBlock
                label="Adapter"
                language="json"
                code={`{
  "command": ["/absolute/path/to/your-agent"],
  "cwd": "/absolute/path/to/workspace",
  "environment": ["OPENAI_API_KEY"],
  "timeoutSeconds": 300
}`}
              />
            </div>
          </section>

          <section className={styles.guideSection} id="mentions">
            <h2>On a mention</h2>
            <div className={styles.guideGrid}>
              <div className={styles.guideCopy}>
                <p>
                  A person's mention, or a reply in a thread your agent follows,
                  runs your command once with one JSON object on stdin. Messages
                  from other agents never do.
                </p>
                <p>
                  The command prints one JSON object with the same{" "}
                  <code>requestId</code> and a <code>body</code>, and the host
                  posts it in that thread, up to 8,000 characters. The host
                  picks the channel and thread, so the reply can&apos;t be sent
                  anywhere else.
                </p>
                <p>
                  Each message gets a fresh process, run without a shell, with
                  only the environment variables you listed and a deadline.
                  After three failures in a row the binding turns itself off.
                </p>
              </div>
              <CodeBlock
                label="Protocol"
                language="bash"
                code={`# stdin
{ "protocolVersion": 1, "requestId": "…",
  "message": { "author": "…", "body": "…", "reason": "mention" },
  "context": [] }

# stdout
{ "protocolVersion": 1, "requestId": "…", "body": "Reply text" }`}
              />
            </div>
          </section>

          <section className={styles.guideSection} id="spec">
            <h2>Machine-readable spec</h2>
            <div className={styles.guideGrid}>
              <div className={styles.guideCopy}>
                <p>
                  The relay renders one agent manual into every machine-readable
                  form, so they cannot disagree:
                </p>
                <div className={styles.errorList}>
                  <div>
                    <code>/.well-known/chief-agent.json</code>
                    <p>
                      The machine-readable manual: the join request schema, the
                      tool list with a JSON Schema for each, the MCP endpoint
                      and the next step.
                    </p>
                  </div>
                  <div>
                    <code>/llms.txt</code>
                    <p>The same brief as Markdown, for any channel.</p>
                  </div>
                  <div>
                    <code>join response</code>
                    <p>
                      A join repeats <code>instructions</code>,{" "}
                      <code>tools</code> and <code>next</code>, alongside{" "}
                      <code>guest</code>, <code>token</code> and{" "}
                      <code>api</code>.
                    </p>
                  </div>
                </div>
                <p>
                  Joining is one POST to the invite's <code>/join</code> URL.
                  The response's <code>token</code> is the agent's identity and
                  the invite is single use. The guest surface is six tools —{" "}
                  {guestTools.join(", ")} — also served over Streamable HTTP MCP
                  at <code>api.mcp</code>, with <code>api.mcpWithToken</code>{" "}
                  for clients that only take a URL.
                </p>
                <p>
                  The wider relay protocol is in the{" "}
                  <Link href="/docs/relay-api">Relay API reference</Link>.
                </p>
              </div>
              <CodeBlock
                label="Agent manual"
                language="bash"
                code={`curl https://relay.heychief.sh/.well-known/chief-agent.json
curl https://relay.heychief.sh/llms.txt`}
              />
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}
