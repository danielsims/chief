import type { ReactNode } from "react";
import { Claude, Grok, OpenAI, OpenCode, Vercel } from "@lobehub/icons";
import { Building2, Cloud, Laptop, UserRound } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@chief/ui/components/select";

import { ChiefMark } from "../../components/chief-mark";

const sky = "/splash-sky.webp";

export function ProviderIcon({
  provider,
  className = "size-5",
}: {
  provider: string;
  className?: string;
}) {
  const Icon =
    provider === "vercelAiGateway"
      ? Vercel
      : provider === "opencode"
        ? OpenCode
        : provider === "claude"
          ? Claude.Color
          : provider === "grok"
            ? Grok
            : OpenAI;
  return <Icon className={className} />;
}
export function IdentityTile({
  provider,
  name,
  color,
  image,
  className = "",
  stackOrder,
}: {
  provider?: string;
  name?: string;
  color?: string;
  image?: string | null;
  className?: string;
  stackOrder?: number;
}) {
  return (
    <span
      className={`ob-avatar ${className}`}
      style={{
        background: color ?? (provider ? "#f4f4f4" : undefined),
        zIndex: stackOrder,
      }}
    >
      {image ? (
        <img src={image} alt={name ?? "Profile"} />
      ) : provider ? (
        <ProviderIcon provider={provider} />
      ) : color ? (
        <ChiefMark className="size-6" />
      ) : (
        <span className="ob-initial" style={{ backgroundImage: `url(${sky})` }}>
          {name?.slice(0, 1).toUpperCase() ?? <UserRound size={21} />}
        </span>
      )}
    </span>
  );
}
export function SetupHeading({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="ob-heading">
      <h1>{title}</h1>
      <p>{children}</p>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="ob-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}
export function IconSelect({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; icon: ReactNode }[];
  label: string;
  disabled?: boolean;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="ob-select" aria-label={label}>
        <span className="ob-select-value">
          {selected?.icon}
          {selected?.label}
        </span>
      </SelectTrigger>
      <SelectContent className="ob-select-menu">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            <span className="ob-select-value">
              {o.icon}
              {o.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export const locationOptions = [
  { value: "device", label: "On this device", icon: <Laptop size={17} /> },
  { value: "cloud", label: "In the cloud", icon: <Cloud size={17} /> },
];
export const purposeOptions = [
  { value: "personal", label: "Just me", icon: <UserRound size={18} /> },
  { value: "company", label: "A company", icon: <Building2 size={18} /> },
];
/**
 * One picture of the two places Chief can run, captioned below it. It only
 * explains: the choice is made on the next screen, so nothing here looks
 * like something to click.
 */
export function PlacesIllustration() {
  return (
    <figure className="ob-places">
      <div
        className="ob-places-art"
        style={{ backgroundImage: `url(${sky})` }}
        role="img"
        aria-label="Chief on a laptop, and Chief in the cloud"
      >
        <span className="ob-places-half">
          <svg viewBox="0 0 160 104" fill="none" aria-hidden="true">
            <rect
              x="27"
              y="6"
              width="106"
              height="72"
              rx="8"
              fill="rgba(255,255,255,.1)"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M9 92h142"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <ChiefMark x="64" y="26" width="32" height="32" />
          </svg>
        </span>
        <span className="ob-places-divider" aria-hidden="true" />
        <span className="ob-places-half">
          <svg viewBox="0 0 160 104" fill="none" aria-hidden="true">
            {/* The mark shares the laptop's centre line, inside the top lobe. */}
            <path
              d="M42 92H122A22 22 0 0 0 118.9 48.2A37 37 0 0 0 45 46.2A23 23 0 0 0 42 92Z"
              fill="rgba(255,255,255,.1)"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <ChiefMark x="65" y="25" width="34" height="34" />
          </svg>
        </span>
      </div>
      <figcaption className="ob-places-captions">
        <p>
          <strong>On your device</strong>
          <span>Runs on your local agents, like ChatGPT or Claude.</span>
        </p>
        <p>
          <strong>In the cloud</strong>
          <span>Runs online and keeps working while you’re away.</span>
        </p>
      </figcaption>
    </figure>
  );
}
