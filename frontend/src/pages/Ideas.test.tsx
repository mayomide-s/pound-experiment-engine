import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type PipelineRunDetail, type PipelineRunSummary } from "../api/client";
import { IdeasPage } from "./Ideas";

const POUND_QUESTION = "Would you give a stranger \u00a31?";

function makeRunSummary(overrides?: Partial<PipelineRunSummary>): PipelineRunSummary {
  return {
    id: "run-1",
    topic: POUND_QUESTION,
    status: "awaiting_review",
    current_stage: "storyboard_generation",
    created_at: new Date().toISOString(),
    campaign_id: "campaign-1",
    creative_variant_id: "variant-1",
    ...overrides,
  };
}

function makeDetail(overrides?: Partial<PipelineRunDetail>): PipelineRunDetail {
  return {
    pipeline_run: {
      id: "run-1",
      topic: POUND_QUESTION,
      status: "awaiting_review",
      current_stage: "storyboard_generation",
      style_preset: "clean_3d_cartoon",
      input_config_json: {},
    },
    idea: {
      title: POUND_QUESTION,
      topic: POUND_QUESTION,
      hook: POUND_QUESTION,
      concept: "A transparent social experiment.",
      format: "social experiment",
      difficulty: "beginner",
      trend_score: 75,
    },
    script: {
      script_json: {
        scenes: [
          {
            time: "0-2s",
            visual: "Open on the campaign question.",
            dialogue: "",
            on_screen_text: POUND_QUESTION,
            motion_camera: "Fast push-in",
          },
        ],
      },
    },
    storyboard: { frames_json: { storyboard_frames: [] } },
    video: null,
    assets: [],
    prompt_logs: [],
    quality_checks: [],
    manual_post_package: null,
    pipeline_events: [],
    prompt_preview: "Campaign-safe prompt preview",
    review_sections: {},
    campaign_context: {
      campaign_name: "The \u00a31 Experiment",
      hook_type: "direct_question",
      visual_type: "street_interview_style",
      tone: "curious",
      call_to_action: "Take part in the experiment.",
      requested_duration_seconds: 12,
      effective_duration_seconds: 10,
      voiceover_enabled: false,
      text_density: "medium",
    },
    ...overrides,
  };
}

function renderIdeas() {
  return render(
    <MemoryRouter>
      <IdeasPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "listRuns").mockResolvedValue([makeRunSummary()]);
  vi.spyOn(api, "getRun").mockResolvedValue(makeDetail());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Ideas campaign context", () => {
  it("renders the campaign summary for campaign-linked runs", async () => {
    renderIdeas();

    await waitFor(() => {
      expect(screen.getByText("Campaign context")).toBeInTheDocument();
    });

    expect(screen.getByText("The \u00a31 Experiment")).toBeInTheDocument();
    expect(screen.getByText("direct_question")).toBeInTheDocument();
    expect(screen.getByText("street_interview_style")).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("does not render the campaign summary for legacy runs", async () => {
    vi.mocked(api.listRuns).mockResolvedValueOnce([makeRunSummary({ campaign_id: null, creative_variant_id: null })]);
    vi.mocked(api.getRun).mockResolvedValueOnce(makeDetail({ campaign_context: null }));

    renderIdeas();

    await waitFor(() => {
      expect(screen.getByText("Prompt Preview")).toBeInTheDocument();
    });

    expect(screen.queryByText("Campaign context")).not.toBeInTheDocument();
  });
});
