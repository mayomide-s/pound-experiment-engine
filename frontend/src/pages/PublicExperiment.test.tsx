import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, type PublicCheckoutStatusResponse } from "../api/client";
import { ExperimentThankYouPage } from "./ExperimentThankYou";
import { PublicExperimentPage } from "./PublicExperiment";

function mockLocationAssign() {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, origin: "http://localhost:5173", assign },
  });
  return assign;
}

function renderPublicExperiment(initialEntry = "/experiment") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/experiment" element={<PublicExperimentPage />} />
        <Route path="/experiment/thank-you" element={<ExperimentThankYouPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderThankYou(initialEntry = "/experiment/thank-you?session_id=cs_test_123") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/experiment/thank-you" element={<ExperimentThankYouPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.spyOn(api, "createPublicCheckoutSession").mockResolvedValue({
    checkout_session_id: "cs_test_123",
    checkout_url: "https://checkout.stripe.test/session/cs_test_123",
  });
  vi.spyOn(api, "getPublicCheckoutStatus").mockResolvedValue({
    status: "completed",
    payment_status: "paid",
    amount_total_minor: 100,
    currency: "GBP",
    campaign_name: "The £1 Experiment",
    completed_at: "2026-07-13T12:00:00Z",
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Public experiment landing page", () => {
  it("renders the public landing page with required disclosures", () => {
    renderPublicExperiment();

    expect(screen.getByText("Would you give a stranger £1?")).toBeInTheDocument();
    expect(screen.getAllByText("Send £1")).toHaveLength(2);
    expect(screen.getByText("Secure payment handled by Stripe.")).toBeInTheDocument();
    expect(screen.getByText("No product")).toBeInTheDocument();
    expect(screen.getByText("No charity")).toBeInTheDocument();
    expect(screen.getByText("No prize")).toBeInTheDocument();
    expect(screen.getByText("No financial return")).toBeInTheDocument();
  });

  it("shows loading state and redirects using the returned checkout URL", async () => {
    const assign = mockLocationAssign();
    renderPublicExperiment("/experiment?source_code=tiktok.bio");

    fireEvent.click(screen.getAllByRole("button", { name: "Send £1" })[0]);

    expect(screen.getAllByText("Starting secure checkout...")[0]).toBeInTheDocument();
    await waitFor(() => {
      expect(api.createPublicCheckoutSession).toHaveBeenCalledWith({ source_code: "tiktok.bio" });
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/session/cs_test_123");
    });
  });

  it("shows a retryable error when checkout creation fails", async () => {
    vi.mocked(api.createPublicCheckoutSession).mockRejectedValueOnce(new Error("Checkout temporarily unavailable"));
    renderPublicExperiment();

    fireEvent.click(screen.getAllByRole("button", { name: "Send £1" })[0]);

    await waitFor(() => {
      expect(screen.getByText("Checkout temporarily unavailable")).toBeInTheDocument();
    });
  });

  it("ignores invalid source codes safely and shows cancellation state", () => {
    renderPublicExperiment("/experiment?checkout=cancelled&source_code=bad code");

    expect(screen.getByText("Payment cancelled — no payment was taken.")).toBeInTheDocument();
    expect(screen.getByText(/ignored safely/i)).toBeInTheDocument();
  });
});

describe("Experiment thank-you page", () => {
  it("shows loading first and then verified success", async () => {
    renderThankYou();

    expect(screen.getByText("Verifying your participation...")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Thank you — you’re part of the experiment.")).toBeInTheDocument();
      expect(screen.getByText("Your £1 participation was received successfully.")).toBeInTheDocument();
    });
  });

  it("shows a pending verification state and retries a bounded number of times", async () => {
    vi.useFakeTimers();
    const responses: PublicCheckoutStatusResponse[] = [
      { status: "open", payment_status: "paid", amount_total_minor: 100, currency: "GBP", campaign_name: "The £1 Experiment", completed_at: null },
      { status: "open", payment_status: "paid", amount_total_minor: 100, currency: "GBP", campaign_name: "The £1 Experiment", completed_at: null },
      { status: "open", payment_status: "paid", amount_total_minor: 100, currency: "GBP", campaign_name: "The £1 Experiment", completed_at: null },
      { status: "open", payment_status: "paid", amount_total_minor: 100, currency: "GBP", campaign_name: "The £1 Experiment", completed_at: null },
    ];
    vi.mocked(api.getPublicCheckoutStatus).mockImplementation(() => Promise.resolve(responses.shift() ?? responses[0]));

    renderThankYou();
    await vi.runAllTimersAsync();
    expect(screen.getByText("We’re still verifying the payment.")).toBeInTheDocument();

    for (let index = 0; index < 4; index += 1) {
      await vi.advanceTimersByTimeAsync(1200);
    }

    expect(api.getPublicCheckoutStatus).toHaveBeenCalledTimes(4);
  });

  it("shows a safe error state for invalid or failed sessions", async () => {
    renderThankYou("/experiment/thank-you?session_id=invalid");

    await waitFor(() => {
      expect(screen.getByText("We couldn’t confirm this session yet.")).toBeInTheDocument();
      expect(screen.getByText("The return session looked invalid.")).toBeInTheDocument();
    });
  });

  it("shows a safe failure state for expired or failed checkouts", async () => {
    vi.mocked(api.getPublicCheckoutStatus).mockResolvedValueOnce({
      status: "expired",
      payment_status: "unpaid",
      amount_total_minor: 100,
      currency: "GBP",
      campaign_name: "The £1 Experiment",
      completed_at: null,
    });

    renderThankYou();

    await waitFor(() => {
      expect(screen.getByText("This checkout didn’t complete.")).toBeInTheDocument();
      expect(screen.getByText("No confirmed payment was recorded for this session.")).toBeInTheDocument();
    });
  });

  it("shares the experiment link without including the session id", async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareSpy });
    renderThankYou();

    await waitFor(() => {
      expect(screen.getByText("Thank you — you’re part of the experiment.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy experiment link" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://localhost:5173/experiment");
    });

    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => {
      expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({ url: "http://localhost:5173/experiment" }));
    });

    expect(screen.getByRole("link", { name: "Share on WhatsApp" }).getAttribute("href")).not.toContain("cs_test_123");
    expect(screen.getByRole("link", { name: "Share on X" }).getAttribute("href")).not.toContain("cs_test_123");
  });
});
