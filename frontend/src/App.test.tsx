import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { api } from "./api/client";

vi.mock("./components/EnvironmentStatusPanel", () => ({
  EnvironmentStatusPanel: () => <div>env</div>,
}));

vi.mock("./pages/Dashboard", () => ({
  DashboardPage: () => <div>Dashboard page</div>,
}));
vi.mock("./pages/AssetLibrary", () => ({
  AssetLibraryPage: () => <div>Assets page</div>,
}));
vi.mock("./pages/ContentOps", () => ({
  ContentOpsPage: () => <div>Content ops page</div>,
}));
vi.mock("./pages/BatchPlanner", () => ({
  BatchPlannerPage: () => <div>Batch planner page</div>,
}));
vi.mock("./pages/IdeaQueue", () => ({
  IdeaQueuePage: () => <div>Idea queue page</div>,
}));
vi.mock("./pages/Ideas", () => ({
  IdeasPage: () => <div>Ideas page</div>,
}));
vi.mock("./pages/Settings", () => ({
  SettingsPage: () => <div>Settings page</div>,
}));
vi.mock("./pages/VideoReview", () => ({
  VideoReviewPage: () => <div>Video review page</div>,
}));
vi.mock("./pages/Performance", () => ({
  PerformancePage: () => <div>Performance page</div>,
}));
vi.mock("./pages/Campaigns", () => ({
  CampaignsPage: () => <div>Campaigns page</div>,
}));

beforeEach(() => {
  vi.stubEnv("VITE_PUBLIC_CONTACT_EMAIL", "support@example.com");
  vi.spyOn(api, "getAccessStatus").mockResolvedValue({ auth_enabled: false, authenticated: true, environment: "test" });
  vi.spyOn(api, "getPublicExperimentStats").mockResolvedValue({
    campaign_slug: "the-one-pound-experiment",
    participant_count: 12,
    amount_collected_minor: 1200,
    currency: "GBP",
    updated_at: "2026-07-13T12:00:00Z",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("App routing", () => {
  it("keeps the private application navigation working", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Dashboard page")).toBeInTheDocument();
    });

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Campaigns")).toBeInTheDocument();
  });

  it.each([
    ["/experiment", /Would you give a stranger £1\?/i],
    ["/privacy", "Privacy Policy"],
    ["/terms", "Terms"],
    ["/refunds", "Refund Policy"],
    ["/contact", "Contact"],
  ])("renders %s publicly without the private access gate", async (path, headingName) => {
    vi.mocked(api.getAccessStatus).mockResolvedValueOnce({ auth_enabled: true, authenticated: false, environment: "test" });

    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: headingName })).toBeInTheDocument();
    expect(screen.queryByText("Enter app access password")).not.toBeInTheDocument();
    expect(api.getAccessStatus).not.toHaveBeenCalled();
  });
});
