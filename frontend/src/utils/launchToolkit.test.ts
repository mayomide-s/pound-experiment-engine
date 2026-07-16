import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import type { AdminExperimentAnalyticsResponse } from "../api/client";
import {
  BEST_CONVERSION_MIN_STARTS,
  LAUNCH_NOTES_STORAGE_KEY,
  buildLaunchLink,
  buildLaunchShareTargets,
  buildLaunchSourceCode,
  buildLaunchSummary,
  buildSourcePerformanceCsv,
  buildSourcePerformanceRows,
  createLaunchNote,
  filterSourcePerformanceRows,
  loadLaunchNotes,
  saveLaunchNotes,
} from "./launchToolkit";

function makeAnalytics(): AdminExperimentAnalyticsResponse {
  return {
    campaign_slug: "the-one-pound-experiment",
    checkout_sessions_started: 15,
    completed_payments: 6,
    payments_today: 2,
    amount_collected_minor: 725,
    currency: "GBP",
    conversion_rate: 0.4,
    referred_checkout_sessions: 0,
    referred_completed_payments: 0,
    referral_conversion_rate: 0,
    top_sources: [],
    source_performance: [
      {
        source_code: "reddit_askuk_1",
        checkout_sessions_started: 6,
        completed_payments: 3,
        amount_collected_minor: 425,
      },
      {
        source_code: "tiktok_launch_1",
        checkout_sessions_started: 5,
        completed_payments: 2,
        amount_collected_minor: 200,
      },
      {
        source_code: "direct",
        checkout_sessions_started: 4,
        completed_payments: 1,
        amount_collected_minor: 100,
      },
    ],
    top_referrers: [],
    recent_payments: [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("launchToolkit helpers", () => {
  it("normalizes valid source and campaign labels", () => {
    expect(buildLaunchSourceCode(" TikTok ", " Launch_1 ")).toEqual({
      sourceCode: "tiktok_launch_1",
      error: "",
    });
  });

  it("rejects invalid source and uses the provided origin for launch links", () => {
    expect(buildLaunchSourceCode("bad code", "")).toEqual({
      sourceCode: null,
      error: "Enter a valid source code using letters, numbers, hyphens, or underscores.",
    });
    expect(buildLaunchSourceCode("TikTok", "launch#1").sourceCode).toBeNull();
    expect(buildLaunchSourceCode("TikTok", "la\u0443nch").sourceCode).toBeNull();
    expect(buildLaunchLink("instagram", "https://example.org/path/")).toBe("https://example.org/experiment?source=instagram");
    expect(buildLaunchLink("direct", "https://example.org/path/")).toBe("https://example.org/experiment");
  });

  it("builds safely encoded share targets", () => {
    const targets = buildLaunchShareTargets("reddit_askuk_1", "https://example.org");

    expect(targets.launchUrl).toBe("https://example.org/experiment?source=reddit_askuk_1");
    expect(targets.whatsappUrl).toContain(encodeURIComponent(targets.launchUrl));
    expect(targets.twitterUrl).toContain("twitter.com/intent/tweet");
    expect(targets.emailUrl).toContain("mailto:");
  });

  it("calculates source performance, filtering, and best conversion threshold", () => {
    const rows = buildSourcePerformanceRows(makeAnalytics());
    const summary = buildLaunchSummary(rows);

    expect(rows[0].conversionRate).toBe(0.5);
    expect(rows[0].percentageOfCompletedPayments).toBe(0.5);
    expect(summary.bestPerformingSource).toBe("reddit_askuk_1");
    expect(summary.bestConversionSource).toBe("reddit_askuk_1");
    expect(filterSourcePerformanceRows(rows, "tiktok", "all")).toHaveLength(1);
    expect(filterSourcePerformanceRows(rows, "", "zero-completed")).toHaveLength(0);
    expect(BEST_CONVERSION_MIN_STARTS).toBe(5);
  });

  it("does not pick a best conversion source without enough starts", () => {
    const rows = buildSourcePerformanceRows({
      ...makeAnalytics(),
      source_performance: [
        {
          source_code: "friend",
          checkout_sessions_started: 1,
          completed_payments: 1,
          amount_collected_minor: 100,
        },
      ],
    });

    expect(buildLaunchSummary(rows).bestConversionSource).toBeNull();
  });

  it("builds a csv export with escaped values, formula protection, and a stable filename", () => {
    const { csv, filename } = buildSourcePerformanceCsv([
      {
        source_code: "=reddit,askuk",
        checkout_sessions_started: 6,
        completed_payments: 3,
        amount_collected_minor: 425,
        conversionRate: 0.5,
        percentageOfCompletedPayments: 0.5,
      },
    ], "GBP", new Date("2026-07-16T12:00:00Z"));

    expect(filename).toBe("experiment-source-performance-2026-07-16.csv");
    expect(csv).toContain("\"'=reddit,askuk\"");
    expect(csv).toContain("0.5000");
  });

  it("creates, saves, loads, and safely recovers launch notes", () => {
    const note = createLaunchNote(" TikTok ");
    saveLaunchNotes([{ ...note, sourceCode: "" }]);

    const loaded = loadLaunchNotes();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sourceCode).toBe("direct");

    window.localStorage.setItem(LAUNCH_NOTES_STORAGE_KEY, "{not-json");
    expect(loadLaunchNotes()).toEqual([]);
  });

  it("ignores local storage write failures safely", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => saveLaunchNotes([createLaunchNote("reddit")])).not.toThrow();

    setItemSpy.mockRestore();
  });
});
