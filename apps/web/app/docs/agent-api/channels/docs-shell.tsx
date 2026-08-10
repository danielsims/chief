"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import type { ChannelDocsModel, DocField, DocOperation } from "./docs-model";
import { BrandMark } from "../../../brand-mark";
import { CodeBlock } from "./code-block";
import styles from "./page.module.css";

function MethodBadge({
  method,
  small = false,
}: {
  method: string;
  small?: boolean;
}) {
  return (
    <span
      className={`${styles.method} ${styles[`method${method}`]} ${small ? styles.methodSmall : ""}`}
    >
      {method}
    </span>
  );
}

function FieldTable({ fields, title }: { fields: DocField[]; title: string }) {
  if (fields.length === 0) return null;
  return (
    <div className={styles.fieldGroup}>
      <p className={styles.miniLabel}>{title}</p>
      <div className={styles.fieldTable}>
        {fields.map((field) => (
          <div className={styles.field} key={field.name}>
            <div className={styles.fieldMeta}>
              <code>{field.name}</code>
              <span>{field.type}</span>
              {field.required ? <em>required</em> : null}
            </div>
            {field.description ? <p>{field.description}</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function OperationSection({ operation }: { operation: DocOperation }) {
  return (
    <section className={styles.operation} id={operation.id}>
      <div className={styles.operationGrid}>
        <div className={styles.operationCopy}>
          <div className={styles.endpoint}>
            <MethodBadge method={operation.method} />
            <code>{operation.path}</code>
          </div>
          <h3>{operation.summary}</h3>
          <p className={styles.description}>{operation.description}</p>
          <div className={styles.permissionRow}>
            <span>{operation.permission}</span>
            <span>{operation.reversible ? "Reversible" : "Durable write"}</span>
          </div>
          <FieldTable fields={operation.params} title="Parameters" />
          <FieldTable fields={operation.bodyFields} title="Body" />
          <div className={styles.fieldGroup}>
            <p className={styles.miniLabel}>Responses</p>
            <div className={styles.responseTable}>
              {operation.responses.map((response) => (
                <div key={response.status}>
                  <span
                    className={
                      response.status.startsWith("2")
                        ? styles.statusOk
                        : styles.statusError
                    }
                  />
                  <code>{response.status}</code>
                  <p>{response.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className={styles.samples}>
          <CodeBlock
            code={operation.requestSample}
            label="Request"
            language="bash"
          />
          <CodeBlock
            code={operation.responseSample}
            label="Response"
            language="json"
          />
        </div>
      </div>
    </section>
  );
}

function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? "introduction");
  const positions = useRef(new Map<string, number>());
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          positions.current.set(
            entry.target.id,
            entry.isIntersecting ? entry.boundingClientRect.top : Infinity,
          );
        }
        const visible = [...positions.current.entries()]
          .filter(([, top]) => top !== Infinity)
          .sort(([, a], [, b]) => Math.abs(a - 88) - Math.abs(b - 88))[0];
        if (visible) setActive(visible[0]);
      },
      { rootMargin: "-8% 0px -68% 0px", threshold: [0, 0.1] },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function NavLink({
  active,
  children,
  id,
  onSelect,
}: {
  active: boolean;
  children: ReactNode;
  id: string;
  onSelect: () => void;
}) {
  return (
    <a
      className={active ? styles.navActive : undefined}
      href={`#${id}`}
      onClick={onSelect}
    >
      {children}
    </a>
  );
}

export function DocsShell({ model }: { model: ChannelDocsModel }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sectionIds = useMemo(
    () => [
      "introduction",
      "security",
      "errors",
      ...model.groups.flatMap((group) =>
        group.operations.map((operation) => operation.id),
      ),
      "models",
    ],
    [model],
  );
  const active = useScrollSpy(sectionIds);
  const closeMenu = () => setMenuOpen(false);
  const navigation = (
    <nav className={styles.nav} aria-label="Agent CLI sections">
      <NavLink
        active={active === "introduction"}
        id="introduction"
        onSelect={closeMenu}
      >
        Introduction
      </NavLink>
      <NavLink
        active={active === "security"}
        id="security"
        onSelect={closeMenu}
      >
        Security
      </NavLink>
      <NavLink active={active === "errors"} id="errors" onSelect={closeMenu}>
        Errors
      </NavLink>
      {model.groups.map((group) => (
        <div className={styles.navGroup} key={group.name}>
          <p>{group.name}</p>
          {group.operations.map((operation) => (
            <NavLink
              active={active === operation.id}
              id={operation.id}
              key={operation.id}
              onSelect={closeMenu}
            >
              <MethodBadge method={operation.method} small />
              <span>{operation.summary}</span>
            </NavLink>
          ))}
        </div>
      ))}
      <div className={styles.navGroup}>
        <p>Reference</p>
        <NavLink active={active === "models"} id="models" onSelect={closeMenu}>
          Models
        </NavLink>
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
            <Link href="/">← Back to Chief</Link>
            <a href="/docs/agent-api/openapi.json">OpenAPI JSON</a>
          </div>
        </aside>
        <article className={styles.main}>
          <section className={styles.introduction} id="introduction">
            <div className={styles.badges}>
              <span>Internal</span>
              <span>Nostr-backed</span>
              <span>Local-first</span>
            </div>
            <h1>Chief Agent CLI</h1>
            <p className={styles.lede}>
              The internal commands Chief agents use to manage channels,
              messages and proactive work.
            </p>
            <div className={styles.introGrid}>
              <div>
                <p className={styles.miniLabel}>Local runtime</p>
                <code className={styles.baseUrl}>http://127.0.0.1:4318</code>
                <p className={styles.introBody}>
                  Loopback only. Agents reach it through Executor with a fresh,
                  session-bound Chief credential.
                </p>
              </div>
              <CodeBlock
                label="Quickstart — create a feature channel"
                language="bash"
                code={`chief-agent channels create --json '{
    "name": "Feature sharing",
    "kind": "feature",
    "operationKey": "feature-sharing-work",
    "members": [
      { "type": "agent", "id": "engineer" },
      { "type": "agent", "id": "researcher" }
    ]
  }'`}
              />
            </div>
          </section>

          <section className={styles.guideSection} id="security">
            <h2>Security</h2>
            <div className={styles.principles}>
              {[
                [
                  "Identity",
                  "Every call resolves to one agent, workspace and live session.",
                ],
                [
                  "Executor",
                  "Executor allows, pauses or blocks the tool before it runs.",
                ],
                [
                  "Access",
                  "Agent grants, membership and owner channel locks must all pass.",
                ],
                [
                  "Credentials",
                  "Agent credentials expire after 12 hours and stop working when the session is inactive.",
                ],
                [
                  "Writes",
                  "Retries use operation keys; updates use versions; management actions keep a hash-chained audit record.",
                ],
              ].map(([label, description]) => (
                <div key={label}>
                  <span>{label}</span>
                  <p>{description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.guideSection} id="errors">
            <h2>Errors</h2>
            <div className={styles.guideGrid}>
              <div>
                <p className={styles.sectionIntro}>
                  Stable codes tell the agent whether to refresh, request owner
                  input or stop.
                </p>
                <div className={styles.errorList}>
                  {[
                    [
                      "invalid_input",
                      "A field is missing, malformed or too long.",
                    ],
                    [
                      "channel_not_found",
                      "The room is absent or private to somebody else.",
                    ],
                    [
                      "channel_management_locked",
                      "The owner disabled this kind of agent edit.",
                    ],
                    [
                      "write_conflict",
                      "Refresh the channel and retry against its current version.",
                    ],
                    [
                      "channel_archived",
                      "Restore the room before posting or changing membership.",
                    ],
                  ].map(([code, description]) => (
                    <div key={code}>
                      <code>{code}</code>
                      <p>{description}</p>
                    </div>
                  ))}
                </div>
              </div>
              <CodeBlock
                label="Error envelope"
                language="json"
                code={`{
  "error": "Refresh the channel before retrying.",
  "code": "write_conflict"
}`}
              />
            </div>
          </section>

          {model.groups.map((group) => (
            <div className={styles.operationGroup} key={group.name}>
              <header>
                <h2>{group.name}</h2>
                <p>{group.description}</p>
              </header>
              {group.operations.map((operation) => (
                <OperationSection key={operation.id} operation={operation} />
              ))}
            </div>
          ))}

          <section className={styles.models} id="models">
            <h2>Models</h2>
            <p className={styles.sectionIntro}>
              The durable shapes shared by the operations above.
            </p>
            {model.models.map((modelItem) => (
              <div className={styles.model} key={modelItem.name}>
                <div>
                  <h3>{modelItem.name}</h3>
                  <p className={styles.description}>{modelItem.description}</p>
                  <FieldTable fields={modelItem.fields} title="Fields" />
                </div>
                <CodeBlock
                  code={modelItem.sample}
                  label={modelItem.name}
                  language="json"
                />
              </div>
            ))}
          </section>
        </article>
      </div>
    </main>
  );
}
