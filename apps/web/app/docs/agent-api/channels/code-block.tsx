"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import styles from "./page.module.css";

function highlightJson(code: string): ReactNode[] {
  const tokens =
    /("(?:[^"\\]|\\.)*")(\s*:)?|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?)/g;
  const output: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tokens.exec(code)) !== null) {
    if (match.index > last) {
      output.push(
        <span className={styles.codeMuted} key={key++}>
          {code.slice(last, match.index)}
        </span>,
      );
    }
    const [, stringValue, colon, booleanValue, numberValue] = match;
    output.push(
      <span className={colon ? styles.codeKey : styles.codeValue} key={key++}>
        {stringValue ?? booleanValue ?? numberValue}
      </span>,
    );
    if (colon) {
      output.push(
        <span className={styles.codeMuted} key={key++}>
          {colon}
        </span>,
      );
    }
    last = tokens.lastIndex;
  }
  if (last < code.length) {
    output.push(
      <span className={styles.codeMuted} key={key++}>
        {code.slice(last)}
      </span>,
    );
  }
  return output;
}

function highlightBash(code: string): ReactNode[] {
  const tokens =
    /(chief-agent|curl)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\$[A-Z_]+)|(--json|--query|--cursor|--limit|-H|-d)/g;
  const output: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = tokens.exec(code)) !== null) {
    if (match.index > last) {
      output.push(
        <span className={styles.codeBase} key={key++}>
          {code.slice(last, match.index)}
        </span>,
      );
    }
    const [value, command, doubleQuoted, singleQuoted, environment] = match;
    output.push(
      <span
        className={
          command || environment ? styles.codeAccent : styles.codeString
        }
        key={key++}
      >
        {command ?? doubleQuoted ?? singleQuoted ?? environment ?? value}
      </span>,
    );
    last = tokens.lastIndex;
  }
  if (last < code.length) {
    output.push(
      <span className={styles.codeBase} key={key++}>
        {code.slice(last)}
      </span>,
    );
  }
  return output;
}

export function CodeBlock({
  code,
  label,
  language,
}: {
  code: string;
  label: string;
  language: "bash" | "json";
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{label}</span>
        <button aria-label={`Copy ${label}`} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>
          {language === "json" ? highlightJson(code) : highlightBash(code)}
        </code>
      </pre>
    </div>
  );
}
