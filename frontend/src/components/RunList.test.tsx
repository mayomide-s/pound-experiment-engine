import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PipelineRunSummary } from "../api/client";
import { RunList } from "./RunList";

function makeRun(overrides?: Partial<PipelineRunSummary>): PipelineRunSummary {
  return {
    id: "run-1",
    topic: "Test run",
    status: "awaiting_review",
    current_stage: "idea_generation",
    created_at: "2026-07-13T12:00:00",
    provider: "mock",
    ...overrides,
  };
}

function renderRunList(runs: PipelineRunSummary[]) {
  return render(
    <RunList
      runs={runs}
      totalRuns={runs.length}
      selectedRunId={runs[0]?.id ?? null}
      selectedRunIds={[]}
      statusFilter="all"
      providerFilter="all"
      topicSearch=""
      showArchived={false}
      archivedRunIds={[]}
      onSelect={vi.fn()}
      onSelectionChange={vi.fn()}
      onSelectAllVisible={vi.fn()}
      onClearSelection={vi.fn()}
      onStatusFilterChange={vi.fn()}
      onProviderFilterChange={vi.fn()}
      onTopicSearchChange={vi.fn()}
      onShowArchivedChange={vi.fn()}
      onArchiveRun={vi.fn()}
      onUnarchiveRun={vi.fn()}
      onArchiveSelected={vi.fn()}
      onArchiveFailedRuns={vi.fn()}
      onArchiveOldAwaitingReviewRuns={vi.fn()}
      onArchiveOldCorsRuns={vi.fn()}
    />,
  );
}

describe("RunList campaign attribution", () => {
  it("renders legacy pipeline runs without campaign labels", () => {
    renderRunList([makeRun()]);

    expect(screen.getByText("Test run")).toBeInTheDocument();
    expect(screen.queryByText(/Campaign-linked/)).not.toBeInTheDocument();
  });

  it("renders compact campaign attribution when campaign ids are present", () => {
    renderRunList([
      makeRun({
        campaign_id: "campaign-1",
        creative_variant_id: "variant-1",
      }),
    ]);

    expect(screen.getByText(/Campaign-linked/)).toBeInTheDocument();
    expect(screen.getByText(/campaign:campaign-1/)).toBeInTheDocument();
    expect(screen.getByText(/variant:variant-1/)).toBeInTheDocument();
  });
});
