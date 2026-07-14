import type { ReactNode } from "react";

import { BrandMark } from "./brand-mark";

export function AppleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <a className="wordmark" href="/" aria-label="Chief home">
      <BrandMark className="wordmark-mark" size={18} />
      <strong>Chief</strong>
    </a>
  );
}

export function MarketingHeader() {
  return (
    <header className="site-header">
      <nav aria-label="Main navigation">
        <Wordmark />
        <div className="nav-links">
          <a href="/#product">Product</a>
          <a href="/#team">The team</a>
          <a href="/pricing">Pricing</a>
        </div>
        <div className="nav-actions">
          <a href="/sign-in">Sign in</a>
          <a href="/download">Download</a>
        </div>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer>
      <Wordmark />
      <div>
        <a href="/#product">Product</a>
        <a href="/#team">The team</a>
        <a href="/pricing">Pricing</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a
          href="https://github.com/danielsims/chief"
          rel="noreferrer"
          target="_blank"
        >
          Open source
        </a>
        <a href="/download">Download</a>
      </div>
      <span>© 2026 Latent Supply Pty Ltd</span>
    </footer>
  );
}

export function ContentRail({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`content-rail${className ? ` ${className}` : ""}`}>
      <article>
        <header>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </header>
        <div className="content-body">{children}</div>
      </article>
    </section>
  );
}
