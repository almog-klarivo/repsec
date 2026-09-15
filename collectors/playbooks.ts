import type { PlaybookItem, ResponseTrack } from "../shared/types";

const TEMPLATES: Record<ResponseTrack, Array<Omit<PlaybookItem, "done">>> = {
  remove: [
    { id: "evidence", label: "Capture evidence (URL, screenshot, WHOIS, headers)" },
    { id: "report", label: "File registrar / platform abuse report" },
    { id: "legal", label: "Handoff to counsel if trademark or fraud requires teeth" },
    { id: "verify", label: "Verify takedown or de-index" },
  ],
  displace: [
    { id: "inventory", label: "Map which owned / earned URLs should outrank this" },
    { id: "entity", label: "Ship or refresh entity, profile, and documentation pages" },
    { id: "press", label: "Place or amplify earned coverage on the same query" },
    { id: "verify", label: "Re-collect SERP and confirm first-screen ownership" },
  ],
  occupy: [
    { id: "citations", label: "List every model citation feeding the distorted answer" },
    { id: "correct", label: "Correct or seed the cited sources" },
    { id: "factsheet", label: "Publish citation-grade facts the models can pull" },
    { id: "reprobe", label: "Re-probe models and measure answer delta" },
  ],
  narrative: [
    { id: "holding", label: "Draft holding statement and internal FAQ" },
    { id: "channels", label: "Brief comms, legal, and support" },
    { id: "presence", label: "Confirm standing community presence on the affected surface" },
    { id: "monitor", label: "Watch velocity for 72 hours" },
  ],
};

export function playbookFor(track: ResponseTrack): PlaybookItem[] {
  return TEMPLATES[track].map((item) => ({ ...item, done: false }));
}
