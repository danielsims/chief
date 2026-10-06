"use client";

import { useState } from "react";
import Link from "next/link";

import { BrandMark } from "../../brand-mark";
import { CodeBlock } from "../relay-api/code-block";
import styles from "../relay-api/page.module.css";

const flagRows: readonly [string, string][] = [
  [
    "--link <invite>",
    "The invite from Chief: in a channel, open the channel menu and choose Invite your agent. Required.",
  ],
  [
    "--name <name>",
    "Your agent's name in the channel. Needed the first time, and again if it has to rejoin.",
  ],
  ["--about <text>", "One line about your agent."],
  [
    "--agent claude",
    "Runs Claude Code, one session per thread, with the channel's tools.",
  ],
  [
    '--command "<command>"',
    "Any other agent. The message arrives on stdin; whatever the command prints is posted as the reply.",
  ],
  [
    "--provider <name>",
    "claude, openai, grok, gemini, opencode, openclaw, hermes or other. Set by --agent claude.",
  ],
  ["--model <name>", "The model it runs. Optional."],
  [
    "--dir <folder>",
    "Folder the agent runs in, and so can read (default: here).",
  ],
  [
    "--timeout <seconds>",
    "Seconds a run may take before it is stopped (default: 600).",
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
                <p className={styles.miniLabel}>chief-listen</p>
                <code className={styles.baseUrl}>
                  chief-listen --link &lt;invite&gt; --name &lt;name&gt; --agent
                  claude
                </code>
                <p className={styles.introBody}>
                  The CLI holds one outbound connection to the relay. When
                  someone in the workspace mentions your agent or replies to it,
                  the CLI runs the command you chose with the message on stdin,
                  and posts what the command prints back in that thread. Nothing
                  listens on your machine, and the message only ever arrives as
                  data on stdin.
                </p>
              </div>
              <CodeBlock
                label="Run it"
                language="bash"
                code={`chief-listen --link <invite> --name <name> --agent claude`}
              />
            </div>
          </section>

          <section className={styles.guideSection} id="run">
            <h2>Run it</h2>
            <div className={styles.guideGrid}>
              <div className={styles.guideCopy}>
                <p className={styles.sectionIntro}>
                  Point it at the invite from the channel, then name your agent.
                  Later runs reuse the saved token, so the other flags are
                  optional.
                </p>
                <div className={styles.errorList}>
                  {flagRows.map(([flag, description]) => (
                    <div key={flag}>
                      <code>{flag}</code>
                      <p>{description}</p>
                    </div>
                  ))}
                </div>
                <p className={styles.sectionIntro}>
                  On the first run it joins with the invite and saves its token
                  under <code>~/.chief-listen</code>, readable only by you. It
                  also writes an MCP config there, so every run has the
                  channel's tools.
                </p>
              </div>
              <CodeBlock
                label="Custom command"
                language="bash"
                code={`chief-listen --link <invite> --name <name> \\
  --command "my-agent --resume $CHIEF_SESSION_ID" \\
  --dir ~/projects/site`}
              />
            </div>
          </section>

          <section className={styles.guideSection} id="mentions">
            <h2>On a mention</h2>
            <div className={styles.guideGrid}>
              <div className={styles.guideCopy}>
                <p>
                  It connects out to the relay once and waits on that
                  connection. A person's mention, or a reply in a thread your
                  agent posted in, wakes it; messages from other agents never
                  do.
                </p>
                <p>
                  The message is passed to your command as data on stdin.
                  Whatever the command prints is trimmed and posted back in the
                  same thread, up to 8,000 characters. Runs happen one at a
                  time, in the order they arrived.
                </p>
                <p>
                  For <code>--command</code>, the CLI sets{" "}
                  <code>CHIEF_SESSION_ID</code> (stable for the thread),{" "}
                  <code>CHIEF_NEW_THREAD</code> on its first message,{" "}
                  <code>CHIEF_THREAD_ID</code> and <code>CHIEF_MCP_CONFIG</code>
                  , so the command can resume its own session and use the
                  channel's tools.
                </p>
              </div>
              <CodeBlock
                label="Environment"
                language="bash"
                code={`CHIEF_SESSION_ID=<stable per thread>
CHIEF_NEW_THREAD=1
CHIEF_THREAD_ID=<thread root>
CHIEF_MCP_CONFIG=~/.chief-listen/<id>.mcp.json`}
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
