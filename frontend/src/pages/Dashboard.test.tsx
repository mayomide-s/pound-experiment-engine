import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type AccountDefaults, type HealthDetails, type PipelineRunDetail } from "../api/client";
import { DASHBOARD_PREFILL_STORAGE_KEY } from "../utils/batchPlanner";
import { DashboardPage } from "./Dashboard";

vi.mock("../components/EventTimeline", () => ({
  EventTimeline: () => <div data-testid="event-timeline" />,
}));

vi.mock("../components/RunList", () => ({
  RunList: () => <div data-testid="run-list" />,
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeAccountDefaults(overrides?: Partial<AccountDefaults["account_config_json"]>): AccountDefaults {
  return {
    account_name: "Test Account",
    niche: "coding",
    account_config_json: {
      default_style_preset: "whiteboard_character",
      target_platforms: ["instagram", "youtube"],
      default_caption_tone: "clear and calm",
      default_hashtag_set: ["#coding"],
      default_duration_seconds: 24,
      default_audience_level: "advanced",
      default_content_format: "bug explanation",
      brand_description: "Explainers",
      preferred_cta: "Follow for more",
      avoid_phrases: [],
      emoji_preference: "minimal",
      style_presets: {},
      ...overrides,
    },
  };
}

function makeHealthDetails(): HealthDetails {
  return {
    status: "ok",
    backend_reachable: true,
    environment: "test",
    auth_enabled: false,
    video_provider: "mock",
    storage_provider: "local",
    runway_mode_enabled: false,
    r2_public_base_url_configured: false,
    checks: {},
  };
}

function makeRunDetail(topic: string): PipelineRunDetail {
  return {
    pipeline_run: {
      id: "run-1",
      topic,
      status: "queued",
      current_stage: "queued",
      style_preset: "clean_3d_cartoon",
    },
    idea: null,
    script: null,
    storyboard: null,
    video: null,
    assets: [],
    prompt_logs: [],
    quality_checks: [],
    manual_post_package: null,
    pipeline_events: [],
  };
}

function seedHandoff(payload: unknown) {
  window.localStorage.setItem(DASHBOARD_PREFILL_STORAGE_KEY, JSON.stringify(payload));
}

function renderDashboard(options?: { strict?: boolean }) {
  const page = (
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );

  return render(options?.strict ? <StrictMode>{page}</StrictMode> : page);
}

beforeEach(() => {
  vi.spyOn(api, "getHealthDetails").mockResolvedValue(makeHealthDetails());
  vi.spyOn(api, "listRuns").mockResolvedValue([]);
  vi.spyOn(api, "getRun").mockResolvedValue(makeRunDetail("Loaded run"));
  vi.spyOn(api, "createRun").mockResolvedValue(makeRunDetail("Created run"));
  vi.spyOn(api, "getExperimentAnalytics").mockResolvedValue({
    campaign_slug: "the-one-pound-experiment",
    checkout_sessions_started: 4,
    completed_payments: 3,
    payments_today: 2,
    amount_collected_minor: 300,
    currency: "GBP",
    conversion_rate: 0.75,
    referred_checkout_sessions: 2,
    referred_completed_payments: 1,
    referral_conversion_rate: 0.5,
    top_sources: [],
    source_performance: [
      {
        source_code: "reddit_askuk_1",
        checkout_sessions_started: 6,
        completed_payments: 3,
        amount_collected_minor: 300,
      },
      {
        source_code: "tiktok_launch_1",
        checkout_sessions_started: 5,
        completed_payments: 1,
        amount_collected_minor: 100,
      },
      {
        source_code: "direct",
        checkout_sessions_started: 2,
        completed_payments: 0,
        amount_collected_minor: 0,
      },
    ],
    top_referrers: [
      {
        referral_code: "r_ab12cd34",
        checkout_sessions_started: 2,
        completed_payments: 1,
        amount_collected_minor: 100,
      },
    ],
    recent_payments: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardPage handoff precedence", () => {
  it("shows handoff values immediately, keeps the notice, and clears storage after capture", async () => {
    const defaults = createDeferred<AccountDefaults>();
    vi.spyOn(api, "getAccountDefaults").mockReturnValue(defaults.promise);
    seedHandoff({
      topic: "APIs explained as restaurant waiters",
      audienceLevel: "beginner",
      contentFormat: "quick concept explainer",
      sourceBatchName: "Sprint 1",
    });

    renderDashboard();

    expect(screen.getByLabelText("Topic")).toHaveValue("APIs explained as restaurant waiters");
    expect(screen.getByLabelText("Audience Level")).toHaveValue("beginner");
    expect(screen.getByLabelText("Content Format")).toHaveValue("quick concept explainer");
    expect(screen.getByText(/Loaded 'APIs explained as restaurant waiters' from Sprint 1/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(window.localStorage.getItem(DASHBOARD_PREFILL_STORAGE_KEY)).toBeNull();
    });

    defaults.resolve(makeAccountDefaults());
    await waitFor(() => {
      expect(screen.getByLabelText("Style Preset")).toHaveValue("whiteboard_character");
    });

    expect(screen.getByLabelText("Audience Level")).toHaveValue("beginner");
    expect(screen.getByLabelText("Content Format")).toHaveValue("quick concept explainer");
  });

  it("keeps handoff audience and format even when defaults resolve immediately", async () => {
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue(makeAccountDefaults());
    seedHandoff({
      topic: "JWT explained as a nightclub wristband",
      audienceLevel: "intermediate",
      contentFormat: "coding metaphor",
      sourceBatchName: "Sprint 1",
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText("Style Preset")).toHaveValue("whiteboard_character");
    });

    expect(screen.getByLabelText("Topic")).toHaveValue("JWT explained as a nightclub wristband");
    expect(screen.getByLabelText("Audience Level")).toHaveValue("intermediate");
    expect(screen.getByLabelText("Content Format")).toHaveValue("coding metaphor");
  });

  it("keeps handoff values usable when defaults fail", async () => {
    vi.spyOn(api, "getAccountDefaults").mockRejectedValue(new Error("Defaults unavailable"));
    const createRunSpy = vi.mocked(api.createRun);
    createRunSpy.mockResolvedValue(makeRunDetail("APIs explained as restaurant waiters"));
    seedHandoff({
      topic: "APIs explained as restaurant waiters",
      audienceLevel: "beginner",
      contentFormat: "quick concept explainer",
      sourceBatchName: "Sprint 1",
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Defaults unavailable")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Run" }));

    await waitFor(() => {
      expect(createRunSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: "APIs explained as restaurant waiters",
          audience_level: "beginner",
          content_format: "quick concept explainer",
        }),
      );
    });
  });

  it("applies account defaults when no handoff exists", async () => {
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue(makeAccountDefaults());

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText("Style Preset")).toHaveValue("whiteboard_character");
    });

    expect(screen.getByLabelText("Audience Level")).toHaveValue("advanced");
    expect(screen.getByLabelText("Content Format")).toHaveValue("bug explanation");
    expect(screen.getByLabelText("Topic")).toHaveValue("CORS");
  });

  it("keeps built-in defaults when no handoff exists and defaults fail", async () => {
    vi.spyOn(api, "getAccountDefaults").mockRejectedValue(new Error("Defaults unavailable"));

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Defaults unavailable")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Topic")).toHaveValue("CORS");
    expect(screen.getByLabelText("Audience Level")).toHaveValue("beginner");
    expect(screen.getByLabelText("Content Format")).toHaveValue("coding metaphor");
    expect(screen.getByLabelText("Style Preset")).toHaveValue("clean_3d_cartoon");
  });

  it("does not let late defaults overwrite manual edits before resolution", async () => {
    const defaults = createDeferred<AccountDefaults>();
    vi.spyOn(api, "getAccountDefaults").mockReturnValue(defaults.promise);

    renderDashboard();

    fireEvent.change(screen.getByLabelText("Audience Level"), {
      target: { value: "intermediate" },
    });
    fireEvent.change(screen.getByLabelText("Content Format"), {
      target: { value: "quick concept explainer" },
    });
    fireEvent.change(screen.getByLabelText("Style Preset"), {
      target: { value: "office_comedy" },
    });
    fireEvent.change(screen.getByLabelText("Caption Tone"), {
      target: { value: "high energy" },
    });
    fireEvent.change(screen.getByLabelText("Duration Preference"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByLabelText("youtube"));

    defaults.resolve(makeAccountDefaults());

    await waitFor(() => {
      expect(screen.getByLabelText("Audience Level")).toHaveValue("intermediate");
    });

    expect(screen.getByLabelText("Content Format")).toHaveValue("quick concept explainer");
    expect(screen.getByLabelText("Style Preset")).toHaveValue("office_comedy");
    expect(screen.getByLabelText("Caption Tone")).toHaveValue("high energy");
    expect(screen.getByLabelText("Duration Preference")).toHaveValue(12);
    expect(screen.getByLabelText("youtube")).not.toBeChecked();
  });

  it("consumes the handoff once across Strict Mode remounting and later fresh mounts", async () => {
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue(makeAccountDefaults());
    seedHandoff({
      topic: "Rate limits explained as nightclub capacity",
      audienceLevel: "beginner",
      contentFormat: "coding metaphor",
      sourceBatchName: "Sprint 1",
    });

    const view = renderDashboard({ strict: true });

    expect(screen.getByLabelText("Topic")).toHaveValue("Rate limits explained as nightclub capacity");
    await waitFor(() => {
      expect(window.localStorage.getItem(DASHBOARD_PREFILL_STORAGE_KEY)).toBeNull();
    });

    view.unmount();

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByLabelText("Style Preset")).toHaveValue("whiteboard_character");
    });

    expect(screen.getByLabelText("Topic")).toHaveValue("CORS");
    expect(screen.queryByText(/Dashboard handoff/i)).not.toBeInTheDocument();
  });

  it("keeps the handoff notice after failed creation and clears it after successful creation", async () => {
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue(makeAccountDefaults());
    const createRunSpy = vi.mocked(api.createRun);
    seedHandoff({
      topic: "Git branches explained as alternate timelines",
      audienceLevel: "intermediate",
      contentFormat: "coding metaphor",
      sourceBatchName: "Sprint 1",
    });

    createRunSpy.mockRejectedValueOnce(new Error("Create failed"));

    renderDashboard();

    fireEvent.click(screen.getByRole("button", { name: "Create Run" }));

    await waitFor(() => {
      expect(screen.getByText("Create failed")).toBeInTheDocument();
    });

    expect(screen.getByText(/Loaded 'Git branches explained as alternate timelines' from Sprint 1/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Topic")).toHaveValue("Git branches explained as alternate timelines");

    createRunSpy.mockResolvedValueOnce(makeRunDetail("Git branches explained as alternate timelines"));

    fireEvent.click(screen.getByRole("button", { name: "Create Run" }));

    await waitFor(() => {
      expect(screen.queryByText(/Dashboard handoff/i)).not.toBeInTheDocument();
    });

    expect(createRunSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        topic: "Git branches explained as alternate timelines",
        audience_level: "intermediate",
        content_format: "coding metaphor",
      }),
    );
  });

  it("renders referral analytics metrics and top referrers", async () => {
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue(makeAccountDefaults());

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Referred Sessions")).toBeInTheDocument();
    });

    expect(screen.getByText("Referral Conversion")).toBeInTheDocument();
    expect(screen.getByText("Top Referrers")).toBeInTheDocument();
    expect(screen.getByText("r_ab12cd34")).toBeInTheDocument();
    expect(screen.getAllByText("50.0%").length).toBeGreaterThan(0);
  });

  it("renders launch toolkit metrics and filters source performance", async () => {
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue(makeAccountDefaults());

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Launch Toolkit")).toBeInTheDocument();
    });

    const sourcePerformanceSection = screen.getByText("Source Performance").closest("article");
    expect(sourcePerformanceSection).not.toBeNull();
    const sourcePerformanceQueries = within(sourcePerformanceSection as HTMLElement);

    expect(screen.getAllByText("reddit_askuk_1").length).toBeGreaterThan(0);
    expect(screen.getByText("Best performing")).toBeInTheDocument();
    expect(screen.getByText("reddit_askuk_1 (50.0%)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search sources"), {
      target: { value: "tiktok" },
    });

    expect(sourcePerformanceQueries.getByText("tiktok_launch_1")).toBeInTheDocument();
    expect(sourcePerformanceQueries.queryByText("reddit_askuk_1")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter"), {
      target: { value: "zero-completed" },
    });
    fireEvent.change(screen.getByLabelText("Search sources"), {
      target: { value: "" },
    });

    expect(sourcePerformanceQueries.getByText("direct")).toBeInTheDocument();
    expect(sourcePerformanceQueries.queryByText("tiktok_launch_1")).not.toBeInTheDocument();
  });

  it("shows copy success and clipboard failure states in the launch toolkit", async () => {
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue(makeAccountDefaults());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Launch Toolkit")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "TikTok" }));
    fireEvent.change(screen.getByLabelText("Campaign label"), {
      target: { value: "launch_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/experiment?source=tiktok_launch_1"));
    });
    expect(screen.getByText("Link copied")).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: /copy link|link copied/i }));

    await waitFor(() => {
      expect(screen.getByText("Clipboard access failed. You can still open or share the link directly.")).toBeInTheDocument();
    });
  });

  it("lets launch notes be added and removed locally", async () => {
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue(makeAccountDefaults());

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Launch Notes")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => {
      expect(screen.getByText("Launch note 1")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Channel"), {
      target: { value: "TikTok main account" },
    });
    expect(screen.getByDisplayValue("TikTok main account")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    await waitFor(() => {
      expect(screen.getByText("No launch notes yet.")).toBeInTheDocument();
    });
  });

  it("exports csv safely and revokes the object url", async () => {
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue(makeAccountDefaults());
    const createObjectURL = vi.fn().mockReturnValue("blob:test-launch-toolkit");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText("Launch Toolkit")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-launch-toolkit");
    });
  });
});
