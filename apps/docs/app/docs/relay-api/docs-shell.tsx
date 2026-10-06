"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import type { DocField, DocOperation, DocsModel } from "./docs-model";
import { BrandMark } from "../../brand-mark";
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
        <div>
          <div className={styles.endpoint}>
            <MethodBadge method={operation.method} />
            <code>{operation.path}</code>
          </div>
          <h3>{operation.summary}</h3>
          {operation.description ? (
            <p className={styles.description}>{operation.description}</p>
          ) : null}
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
          {operation.responseSample ? (
            <CodeBlock
              code={operation.responseSample}
              label="Response"
              language="json"
            />
          ) : null}
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

export function DocsShell({ model }: { model: DocsModel }) {
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
    <nav className={styles.nav} aria-label="Relay API sections">
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
        Authentication
      </NavLink>
      <NavLink active={active === "errors"} id="errors" onSelect={closeMenu}>
        Errors
      </NavLink>
      {model.groups.map((group) => (
        <div className={styles.navGroup} key={group.tag}>
          <p>{group.tag}</p>
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
          <span>Relay API</span>
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
            <span>Relay API</span>
          </Link>
          <div className={styles.navScroll}>{navigation}</div>
          <div className={styles.sidebarFooter}>
            <a href="https://heychief.sh">← Back to Chief</a>
            <Link href="/docs/agent-cli">Agent CLI</Link>
            <Link href="/docs/relay-api/openapi.json">OpenAPI JSON</Link>
          </div>
        </aside>
        <article className={styles.main}>
          <section className={styles.introduction} id="introduction">
            <h1>{model.title}</h1>
            <p className={styles.lede}>{model.description}</p>
            <div className={styles.introGrid}>
              <div>
                <p className={styles.miniLabel}>Base URL</p>
                <code className={styles.baseUrl}>{model.baseUrl}</code>
                <p className={styles.introBody}>
                  Every endpoint speaks JSON. Requests are signed with a NIP-98
                  Nostr event and answered with one consistent error envelope.
                  This reference renders from the OpenAPI document the relay
                  serves at /v1/openapi.json.
                </p>
              </div>
              <CodeBlock
                label="Quickstart — check health"
                language="bash"
                code={`curl ${model.baseUrl}/health`}
              />
            </div>
          </section>

          <section className={styles.guideSection} id="security">
            <h2>Authentication</h2>
            <div className={styles.guideGrid}>
              <div className={styles.guideCopy}>
                <p>
                  Every request carries a NIP-98 Nostr event in the{" "}
                  <code>Authorization</code> header. The event is bound to the
                  request URL, method and body hash, and expires shortly after
                  it is signed.
                </p>
                <CodeBlock
                  label="Authorization header"
                  language="bash"
                  code={`curl ${model.baseUrl}/v1/me/workspace \\
  -H "Authorization: Nostr $CHIEF_RELAY_AUTH"`}
                />
              </div>
            </div>
            <div className={styles.principles}>
              {[
                [
                  "Identity",
                  "The signed key resolves to one device, user or agent identity.",
                ],
                [
                  "Access",
                  "The identity must be a workspace member with permission for the operation.",
                ],
                [
                  "Idempotency",
                  "Commands carry a commandId; a retry with the same id returns the original result.",
                ],
                [
                  "Live updates",
                  "WebSocket access uses short-lived, single-use tickets minted per conversation.",
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
                  Every non-2xx response carries the same envelope. The code is
                  machine-readable; the message says what happened.
                </p>
                <div className={styles.errorList}>
                  {[
                    [
                      "unauthenticated",
                      "The Nostr Authorization header is missing or invalid.",
                    ],
                    [
                      "forbidden",
                      "The signed identity cannot perform this operation.",
                    ],
                    [
                      "invalid_request",
                      "The request could not be parsed or validated.",
                    ],
                    [
                      "not_found",
                      "The workspace, conversation or resource is missing or not visible.",
                    ],
                    [
                      "method_not_allowed",
                      "The route exists but not for this HTTP method.",
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
  "error": {
    "code": "forbidden",
    "message": "Only workspace owners and admins can change its image.",
    "requestId": "01J..."
  }
}`}
              />
            </div>
          </section>

          {model.groups.map((group) => (
            <div className={styles.operationGroup} key={group.tag}>
              <header>
                <h2>{group.tag}</h2>
                {group.description ? <p>{group.description}</p> : null}
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
                  {modelItem.description ? (
                    <p className={styles.description}>
                      {modelItem.description}
                    </p>
                  ) : null}
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
