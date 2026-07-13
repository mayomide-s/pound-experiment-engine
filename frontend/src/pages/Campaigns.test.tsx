import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, Campaign, CreativeVariant, PipelineRunDetail } from "../api/client";
import App from "../App";
import { CampaignsPage } from "./Campaigns";

vi.mock("../components/EnvironmentStatusPanel", () => ({
  EnvironmentStatusPanel: () => <div data-testid="env-panel" />,
}));

function makeCampaign(overrides?: Partial<Campaign>): Campaign {
  return {
    id: "campaign-1",
    name: "The £1 Experiment",
    slug: "the-one-pound-experiment",
    core_question: "Would you give a stranger £1?",
    description: "A transparent internet social experiment.",
    landing_page_url: "https://example.com/experiment",
    currency: "GBP",
    target_amount_minor: 100,
    target_reach: 10000000,
    status: "draft",
    content_rules_json: {},
    target_platforms_json: ["tiktok", "instagram", "youtube"],
    start_date: null,
    end_date: null,
    created_at: "2026-07-13T12:00:00",
    updated_at: "2026-07-13T12:30:00",
    ...overrides,
  };
}

function makeVariant(overrides?: Partial<CreativeVariant>): CreativeVariant {
  return {
    id: "variant-1",
    campaign_id: "campaign-1",
    hook_type: "direct_question",
    visual_type: "street_interview_style",
    tone: "curious",
    call_to_action: "Take part in the experiment.",
    video_length_seconds: 15,
    voiceover_enabled: true,
    text_density: "low",
    tracking_code: "trk-001",
    experiment_config_json: {},
    created_at: "2026-07-13T12:00:00",
    updated_at: "2026-07-13T12:30:00",
    ...overrides,
  };
}

function makeRunDetail(runId: string): PipelineRunDetail {
  return {
    pipeline_run: {
      id: runId,
      topic: "Would you give a stranger £1?",
      status: "awaiting_review",
      current_stage: "idea_generation",
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

function renderCampaignsPage() {
  return render(
    <MemoryRouter>
      <CampaignsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.spyOn(api, "listCampaigns").mockResolvedValue({ items: [makeCampaign()] });
  vi.spyOn(api, "getCampaign").mockResolvedValue(makeCampaign());
  vi.spyOn(api, "listCreativeVariants").mockResolvedValue([makeVariant()]);
  vi.spyOn(api, "createCampaign").mockResolvedValue(makeCampaign({ id: "campaign-2", slug: "new-campaign", name: "New Campaign" }));
  vi.spyOn(api, "createCreativeVariant").mockResolvedValue(makeVariant({ id: "variant-2", tracking_code: "trk-002" }));
  vi.spyOn(api, "createRun").mockResolvedValue(makeRunDetail("run-123"));
});

describe("CampaignsPage", () => {
  it("shows loading and then renders the campaign list", async () => {
    renderCampaignsPage();

    expect(screen.getByText("Loading campaigns...")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("The £1 Experiment")).toBeInTheDocument();
    });
    expect(screen.getByText("Would you give a stranger £1?")).toBeInTheDocument();
  });

  it("shows the empty state and prefills the £1 experiment form", async () => {
    vi.mocked(api.listCampaigns).mockResolvedValueOnce({ items: [] });

    renderCampaignsPage();

    await waitFor(() => {
      expect(screen.getByText("No campaigns yet")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole("button")[1]);

    expect(screen.getByLabelText("Campaign name")).toHaveValue("The £1 Experiment");
    expect(screen.getByLabelText("Campaign slug")).toHaveValue("the-one-pound-experiment");
    expect(screen.getByLabelText("Core question")).toHaveValue("Would you give a stranger £1?");
  });

  it("creates a campaign and refreshes the list", async () => {
    renderCampaignsPage();

    await waitFor(() => {
      expect(screen.getByText("Existing campaigns")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Create campaign" })[0]);
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "New Campaign" } });
    fireEvent.change(screen.getByLabelText("Campaign slug"), { target: { value: "new-campaign" } });
    fireEvent.change(screen.getByLabelText("Core question"), { target: { value: "Would you give a stranger £1?" } });
    fireEvent.change(screen.getByLabelText("Target amount"), { target: { value: "3.50" } });
    fireEvent.change(screen.getByLabelText("Target reach"), { target: { value: "2500" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Create campaign" })[1]);

    await waitFor(() => {
      expect(api.createCampaign).toHaveBeenCalledWith(expect.objectContaining({
        name: "New Campaign",
        slug: "new-campaign",
        target_amount_minor: 350,
        target_reach: 2500,
      }));
    });
  });

  it("renders the campaign detail view", async () => {
    renderCampaignsPage();

    await waitFor(() => {
      expect(screen.getByText("Campaign Detail")).toBeInTheDocument();
    });
    expect(screen.getByText("Creative Variants")).toBeInTheDocument();
    expect(screen.getByText("trk-001")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/experiment")).toBeInTheDocument();
  });

  it("creates a creative variant", async () => {
    renderCampaignsPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create variant" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Create variant" }));
    fireEvent.change(screen.getByLabelText("Tracking code"), { target: { value: "trk-new" } });
    fireEvent.change(screen.getByLabelText("Call to action"), { target: { value: "Join the experiment." } });
    fireEvent.click(screen.getByRole("button", { name: "Create variant" }));

    await waitFor(() => {
      expect(api.createCreativeVariant).toHaveBeenCalledWith("campaign-1", expect.objectContaining({
        tracking_code: "trk-new",
        call_to_action: "Join the experiment.",
      }));
    });
  });

  it("creates a linked pipeline run from a variant", async () => {
    renderCampaignsPage();

    await waitFor(() => {
      expect(screen.getByText("trk-001")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Create run")[0]);
    fireEvent.change(screen.getByLabelText("Topic for trk-001"), { target: { value: "Test linked run" } });
    fireEvent.click(screen.getByRole("button", { name: "Create run" }));

    await waitFor(() => {
      expect(api.createRun).toHaveBeenCalledWith(expect.objectContaining({
        campaign_id: "campaign-1",
        creative_variant_id: "variant-1",
        topic: "Test linked run",
      }));
    });
    expect(screen.getByText("Created run run-123")).toBeInTheDocument();
    expect(screen.getByText("Open Dashboard")).toBeInTheDocument();
  });

  it("shows API errors clearly", async () => {
    vi.mocked(api.createCreativeVariant).mockRejectedValueOnce(new Error("Creative variant tracking code already exists"));
    renderCampaignsPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create variant" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Create variant" }));
    fireEvent.change(screen.getByLabelText("Tracking code"), { target: { value: "trk-dup" } });
    fireEvent.change(screen.getByLabelText("Call to action"), { target: { value: "Join the experiment." } });
    fireEvent.click(screen.getByRole("button", { name: "Create variant" }));

    await waitFor(() => {
      expect(screen.getByText("Creative variant tracking code already exists")).toBeInTheDocument();
    });
  });
});

describe("App navigation", () => {
  it("includes the Campaigns navigation item", async () => {
    vi.spyOn(api, "getAccessStatus").mockResolvedValue({
      auth_enabled: false,
      authenticated: true,
      environment: "test",
    });
    vi.spyOn(api, "getAccountDefaults").mockResolvedValue({
      account_name: "Test Account",
      niche: "coding",
      account_config_json: {
        default_style_preset: "clean_3d_cartoon",
        target_platforms: ["instagram", "tiktok", "youtube"],
        default_caption_tone: "playful explainer",
        default_hashtag_set: [],
        default_duration_seconds: 18,
        default_audience_level: "beginner",
        default_content_format: "coding metaphor",
        brand_description: "Explainers",
        preferred_cta: "Follow",
        avoid_phrases: [],
        emoji_preference: "minimal",
        style_presets: {},
      },
    });
    vi.spyOn(api, "getHealthDetails").mockResolvedValue({
      status: "ok",
      backend_reachable: true,
      environment: "test",
      auth_enabled: false,
      video_provider: "mock",
      storage_provider: "local",
      runway_mode_enabled: false,
      r2_public_base_url_configured: false,
      checks: {},
    });
    vi.spyOn(api, "listRuns").mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Campaigns/i })).toBeInTheDocument();
    });
  });
});
