import type { ReactNode } from "react";
import { Claude, Grok, OpenAI, OpenCode, Vercel } from "@lobehub/icons";
import { Building2, UserRound } from "lucide-react";

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
  const Icon = providerIcons[provider] ?? OpenAI;
  return <Icon className={className} />;
}
const providerIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  vercelAiGateway: Vercel,
  opencode: OpenCode,
  claude: Claude.Color,
  grok: Grok,
  chatgpt: OpenAI,
  codex: OpenAI,
};
/** The logo for an agent that joined itself; "other" goes by its name. */
export function agentBrand(provider: string, name?: string) {
  const key = provider === "other" ? (name ?? "").toLowerCase() : provider;
  return key in providerIcons ? key : null;
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
      ) : provider && agentBrand(provider, name) ? (
        <ProviderIcon provider={agentBrand(provider, name) ?? provider} />
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
export const purposeOptions = [
  { value: "personal", label: "Personal", icon: <UserRound size={18} /> },
  { value: "company", label: "Company", icon: <Building2 size={18} /> },
];
type Place = "device" | "cloud";

const places: {
  value: Place;
  title: string;
  text: string;
  /** What the person needs to know once this place is chosen. */
  note: string;
  /** Background position for this card's crop of the hero image. */
  crop: string;
}[] = [
  {
    value: "device",
    title: "On your device",
    text: "Agents run on this computer, using apps like ChatGPT or Claude.",
    note: "Keep this device open, awake and online while Chief is working.",
    crop: "0% 42%",
  },
  {
    value: "cloud",
    title: "In the cloud",
    text: "Agents run online, so they keep working while you’re away.",
    note: "Chief stays available while you’re away from your device.",
    crop: "78% 8%",
  },
];

/** The one thing to know about where agents run, for the chosen place. */
export function placeNote(value: Place) {
  return places.find((place) => place.value === value)?.note ?? "";
}

/** Two cards, one per place agents can run, each with its own picture. */
export function PlacesPicker({
  value,
  onChange,
}: {
  value: Place;
  onChange: (value: Place) => void;
}) {
  const art = {
    device: (
      <svg viewBox="8 5 144 88" width="101" fill="none" aria-hidden="true">
        <g>
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
        </g>
      </svg>
    ),
    cloud: (
      <svg
        viewBox="1.8 6.8 28.4 18.4"
        width="86"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M16 7C13.35 7 11.05 8.24 9.41 10.06 9.27 10.05 9.15 10 9 10 6.8 10 5 11.8 5 14 3.27 15.05 2 16.84 2 19c0 3.3 2.7 6 6 6h16c3.3 0 6-2.7 6-6 0-3.16-2.49-5.68-5.59-5.91C23.18 9.57 19.93 7 16 7Z"
          fill="rgba(255,255,255,.1)"
          stroke="currentColor"
          strokeWidth="0.35"
          strokeLinejoin="round"
        />
        <ChiefMark x="12.3" y="13.4" width="7.4" height="7.4" />
      </svg>
    ),
  };
  return (
    <div className="ob-places" role="radiogroup" aria-label="Where agents run">
      {places.map((place) => (
        <button
          type="button"
          key={place.value}
          role="radio"
          aria-checked={value === place.value}
          className="ob-place"
          onClick={() => onChange(place.value)}
        >
          <span
            className="ob-place-art"
            style={{
              backgroundImage: `url(${sky})`,
              backgroundPosition: place.crop,
            }}
          >
            {art[place.value]}
          </span>
          <span className="ob-place-text">
            <span className="ob-place-title">
              <strong>{place.title}</strong>
              <span className="ob-radio" aria-hidden="true">
                <span />
              </span>
            </span>
            <span>{place.text}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
