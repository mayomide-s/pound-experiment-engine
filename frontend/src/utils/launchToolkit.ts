import type { AdminExperimentAnalyticsResponse, AdminExperimentSourceAnalyticsResponse } from "../api/client";
import { buildExperimentSourceUrl, validateSourceCode } from "../public/source";

export const LAUNCH_SHARE_MESSAGE = "Would you give \u00A31 to a stranger as part of a simple internet experiment?";
export const LAUNCH_EMAIL_SUBJECT = "Would you try this \u00A31 experiment?";
export const BEST_CONVERSION_MIN_STARTS = 5;
export const LAUNCH_NOTES_STORAGE_KEY = "launch-toolkit-notes/v1";

export const LAUNCH_PRESETS = [
  { label: "TikTok", sourceCode: "tiktok" },
  { label: "Instagram", sourceCode: "instagram" },
  { label: "Reddit", sourceCode: "reddit" },
  { label: "WhatsApp", sourceCode: "whatsapp" },
  { label: "X/Twitter", sourceCode: "x" },
  { label: "Friends", sourceCode: "friend" },
  { label: "Direct outreach", sourceCode: "direct_outreach" },
  { label: "Other", sourceCode: "" },
] as const;

export type LaunchNoteStatus = "planned" | "posted" | "paused" | "complete";

export type LaunchNote = {
  id: string;
  channel: string;
  plannedPostDate: string;
  sourceCode: string;
  status: LaunchNoteStatus;
  notes: string;
};

export type SourcePerformanceRow = AdminExperimentSourceAnalyticsResponse & {
  conversionRate: number;
  percentageOfCompletedPayments: number;
};

export type LaunchSummary = {
  activeSourceCount: number;
  bestPerformingSource: string | null;
  bestConversionSource: string | null;
};

export function buildLaunchSourceCode(baseSourceCode: string, campaignLabel: string) {
  const normalizedBaseSource = validateSourceCode(baseSourceCode);
  if (!normalizedBaseSource) {
    return {
      sourceCode: null,
      error: "Enter a valid source code using letters, numbers, hyphens, or underscores.",
    };
  }

  const trimmedLabel = campaignLabel.trim();
  if (!trimmedLabel) {
    return { sourceCode: normalizedBaseSource, error: "" };
  }

  const normalizedLabel = validateSourceCode(trimmedLabel);
  if (!normalizedLabel) {
    return {
      sourceCode: null,
      error: "Campaign labels must use only lowercase-friendly letters, numbers, hyphens, or underscores.",
    };
  }

  const combined = `${normalizedBaseSource}_${normalizedLabel}`;
  if (!validateSourceCode(combined)) {
    return { sourceCode: null, error: "Combined source code must stay within 64 characters." };
  }

  return { sourceCode: combined, error: "" };
}

export function buildLaunchLink(sourceCode: string | null, origin = window.location.origin) {
  return buildExperimentSourceUrl(sourceCode, origin);
}

export function buildLaunchShareTargets(sourceCode: string | null, origin = window.location.origin) {
  const launchUrl = buildLaunchLink(sourceCode, origin);
  return {
    launchUrl,
    whatsappUrl: `https://wa.me/?text=${encodeURIComponent(`${LAUNCH_SHARE_MESSAGE} ${launchUrl}`)}`,
    twitterUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(LAUNCH_SHARE_MESSAGE)}&url=${encodeURIComponent(launchUrl)}`,
    emailUrl: `mailto:?subject=${encodeURIComponent(LAUNCH_EMAIL_SUBJECT)}&body=${encodeURIComponent(`${LAUNCH_SHARE_MESSAGE}\n\n${launchUrl}`)}`,
  };
}

export function buildSourcePerformanceRows(analytics: AdminExperimentAnalyticsResponse): SourcePerformanceRow[] {
  return analytics.source_performance.map((source) => ({
    ...source,
    conversionRate: source.checkout_sessions_started
      ? source.completed_payments / source.checkout_sessions_started
      : 0,
    percentageOfCompletedPayments: analytics.completed_payments
      ? source.completed_payments / analytics.completed_payments
      : 0,
  }));
}

export function buildLaunchSummary(rows: SourcePerformanceRow[]): LaunchSummary {
  const activeSourceCount = rows.length;
  const bestPerformingSource = rows[0]?.source_code ?? null;
  const bestConversionCandidate = rows
    .filter((row) => row.checkout_sessions_started >= BEST_CONVERSION_MIN_STARTS)
    .sort((left, right) => (
      right.conversionRate - left.conversionRate
      || right.completed_payments - left.completed_payments
      || right.checkout_sessions_started - left.checkout_sessions_started
      || left.source_code.localeCompare(right.source_code)
    ))[0] ?? null;

  return {
    activeSourceCount,
    bestPerformingSource,
    bestConversionSource: bestConversionCandidate?.source_code ?? null,
  };
}

export function filterSourcePerformanceRows(
  rows: SourcePerformanceRow[],
  searchTerm: string,
  statusFilter: "all" | "with-completed" | "zero-completed",
) {
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  return rows.filter((row) => {
    if (normalizedSearchTerm && !row.source_code.toLowerCase().includes(normalizedSearchTerm)) {
      return false;
    }
    if (statusFilter === "with-completed") {
      return row.completed_payments > 0;
    }
    if (statusFilter === "zero-completed") {
      return row.completed_payments === 0;
    }
    return true;
  });
}

function escapeCsvValue(value: string | number) {
  const stringValue = String(value);
  const safeValue = /^[=+\-@]/.test(stringValue) ? `'${stringValue}` : stringValue;
  if (/[",\n]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, "\"\"")}"`;
  }
  return safeValue;
}

export function buildSourcePerformanceCsv(rows: SourcePerformanceRow[], currency: string, now = new Date()) {
  const header = [
    "source_code",
    "checkout_sessions_started",
    "completed_payments",
    "conversion_rate",
    "amount_collected_minor",
    "currency",
    "percentage_of_completed_payments",
  ];
  const body = rows.map((row) => [
    row.source_code,
    row.checkout_sessions_started,
    row.completed_payments,
    row.conversionRate.toFixed(4),
    row.amount_collected_minor,
    currency,
    row.percentageOfCompletedPayments.toFixed(4),
  ]);
  const csv = [header, ...body]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
  const isoDate = now.toISOString().slice(0, 10);
  return {
    csv,
    filename: `experiment-source-performance-${isoDate}.csv`,
  };
}

export function loadLaunchNotes() {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return [] as LaunchNote[];
  }

  try {
    const raw = window.localStorage.getItem(LAUNCH_NOTES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const candidate = item as Partial<LaunchNote>;
      const sourceCode = validateSourceCode(typeof candidate.sourceCode === "string" ? candidate.sourceCode : "");
      const status = candidate.status;
      if (
        typeof candidate.id !== "string"
        || typeof candidate.channel !== "string"
        || typeof candidate.plannedPostDate !== "string"
        || typeof candidate.notes !== "string"
        || !sourceCode
        || !["planned", "posted", "paused", "complete"].includes(String(status))
      ) {
        return [];
      }
      return [{
        id: candidate.id,
        channel: candidate.channel,
        plannedPostDate: candidate.plannedPostDate,
        sourceCode,
        status: status as LaunchNoteStatus,
        notes: candidate.notes,
      }];
    });
  } catch {
    return [];
  }
}

export function saveLaunchNotes(notes: LaunchNote[]) {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  try {
    const sanitizedNotes = notes.map((note) => ({
      ...note,
      sourceCode: validateSourceCode(note.sourceCode) ?? "direct",
    }));
    window.localStorage.setItem(LAUNCH_NOTES_STORAGE_KEY, JSON.stringify(sanitizedNotes));
  } catch {
    // Ignore browser-local storage failures and keep the dashboard usable.
  }
}

export function createLaunchNote(sourceCode = "direct"): LaunchNote {
  const noteId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `launch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id: noteId,
    channel: "",
    plannedPostDate: "",
    sourceCode: validateSourceCode(sourceCode) ?? "direct",
    status: "planned",
    notes: "",
  };
}
