export interface BrowserPageSnapshot {
  url: string;
  title: string;
  text: string;
  controls: string[];
}

export type BrowserAutomationCommand =
  | { type: "snapshot" }
  | { type: "click"; labels: string[] }
  | { type: "fill"; labels: string[]; value: string }
  | { type: "select"; labels: string[]; values: string[] }
  | { type: "press"; key: string };

export interface BrowserAutomationResult {
  snapshot?: BrowserPageSnapshot;
  clicked?: boolean;
  filled?: boolean;
  pressed?: boolean;
  selected?: boolean;
}
