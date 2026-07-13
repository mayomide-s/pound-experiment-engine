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
  vi.spyOn(api, "getAccessStatus").mockResolvedValue({ auth_enabled: false, authenticated: true, environment: "test" });
});

afterEach(() => {
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

  it("renders the public experiment route without the private access gate", async () => {
    vi.mocked(api.getAccessStatus).mockResolvedValueOnce({ auth_enabled: true, authenticated: false, environment: "test" });

    render(
      <MemoryRouter initialEntries={["/experiment"]}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Would you give a stranger/i)).toBeInTheDocument();
    expect(screen.queryByText("Enter app access password")).not.toBeInTheDocument();
  });
});
