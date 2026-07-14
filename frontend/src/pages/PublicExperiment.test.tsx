import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
  type PublicCheckoutStatusResponse,
  type PublicExperimentStatsResponse,
} from "../api/client";
import { normalizePublicReferralCode } from "../public/share";
import { ExperimentThankYouPage } from "./ExperimentThankYou";
import { PublicExperimentPage, normalizePublicSourceCode } from "./PublicExperiment";

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
    </MemoryRouter>,
  );
}

function renderThankYou(initialEntry = "/experiment/thank-you?session_id=cs_test_123") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/experiment/thank-you" element={<ExperimentThankYouPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_PUBLIC_CONTACT_EMAIL", "support@example.com");
  vi.spyOn(api, "createPublicCheckoutSession").mockResolvedValue({
    checkout_session_id: "cs_test_123",
    checkout_url: "https://checkout.stripe.test/session/cs_test_123",
  });
  vi.spyOn(api, "getPublicExperimentStats").mockResolvedValue({
    campaign_slug: "the-one-pound-experiment",
    participant_count: 12,
    amount_collected_minor: 1200,
    currency: "GBP",
    updated_at: "2026-07-13T12:00:00Z",
  } satisfies PublicExperimentStatsResponse);
  vi.spyOn(api, "getPublicCheckoutStatus").mockResolvedValue({
    status: "completed",
    payment_status: "paid",
    amount_total_minor: 100,
    currency: "GBP",
    campaign_name: "The £1 Experiment",
    completed_at: "2026-07-13T12:00:00Z",
    referral_code: "r_share123",
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: undefined,
  });
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Public experiment landing page", () => {
  it("renders trust, how it works, faq, and footer links", async () => {
    renderPublicExperiment();

    expect(screen.getByText(/Would you give a stranger £1\?/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trust and payment details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How it works" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Frequently asked questions" })).toBeInTheDocument();
    expect(screen.getAllByText(/not a charitable donation/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Stripe handles those details/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Privacy" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Terms" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Refunds" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Contact" }).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText("12 people said yes")).toBeInTheDocument();
      expect(screen.getByText(/12\.00 collected so far\./)).toBeInTheDocument();
    });
  });

  it("renders the public landing page with zero totals safely", async () => {
    vi.mocked(api.getPublicExperimentStats).mockResolvedValueOnce({
      campaign_slug: "the-one-pound-experiment",
      participant_count: 0,
      amount_collected_minor: 0,
      currency: "GBP",
      updated_at: "2026-07-13T12:00:00Z",
    });

    renderPublicExperiment();

    await waitFor(() => {
      expect(screen.getByText("0 people said yes")).toBeInTheDocument();
      expect(screen.getByText(/0\.00 collected so far\./)).toBeInTheDocument();
    });
  });

  it("normalizes source and referral codes and redirects using the returned checkout URL", async () => {
    const assign = mockLocationAssign();
    renderPublicExperiment("/experiment?source_code=%20TikTok_Ad%20&ref=%20r_ab12cd34%20");

    fireEvent.click(screen.getAllByRole("button", { name: /Send .*1/i })[0]);

    expect(screen.getAllByText("Starting secure checkout...")[0]).toBeInTheDocument();
    await waitFor(() => {
      expect(api.createPublicCheckoutSession).toHaveBeenCalledWith({
        source_code: "tiktok_ad",
        referral_code: "r_ab12cd34",
      });
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/session/cs_test_123");
    });
  });

  it("ignores invalid referral codes while keeping source attribution separate", async () => {
    const assign = mockLocationAssign();
    renderPublicExperiment("/experiment?source=newsletter&ref=bad.ref");

    fireEvent.click(screen.getAllByRole("button", { name: /Send .*1/i })[0]);

    await waitFor(() => {
      expect(api.createPublicCheckoutSession).toHaveBeenCalledWith({
        source_code: "newsletter",
        referral_code: null,
      });
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/session/cs_test_123");
    });
  });

  it("does not block checkout if the stats request fails", async () => {
    vi.mocked(api.getPublicExperimentStats).mockRejectedValueOnce(new Error("stats unavailable"));
    const assign = mockLocationAssign();
    renderPublicExperiment();

    await waitFor(() => {
      expect(screen.getByText("Live totals are temporarily unavailable.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole("button", { name: /Send .*1/i })[0]);

    await waitFor(() => {
      expect(api.createPublicCheckoutSession).toHaveBeenCalled();
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/session/cs_test_123");
    });
  });

  it("shows a retryable error when checkout creation fails", async () => {
    vi.mocked(api.createPublicCheckoutSession).mockRejectedValueOnce(new Error("Checkout temporarily unavailable"));
    renderPublicExperiment();

    fireEvent.click(screen.getAllByRole("button", { name: /Send .*1/i })[0]);

    await waitFor(() => {
      expect(screen.getByText("Checkout temporarily unavailable")).toBeInTheDocument();
    });
  });

  it("falls back invalid source codes to direct and shows cancellation state", async () => {
    renderPublicExperiment("/experiment?checkout=cancelled&source_code=bad%20code");

    expect(screen.getByText(/Payment cancelled/i)).toBeInTheDocument();
    expect(screen.getByText(/ignored safely/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(api.getPublicExperimentStats).toHaveBeenCalled();
    });
  });

  it("refreshes the live counter when a completion refresh event is dispatched", async () => {
    const refreshedStats = {
      campaign_slug: "the-one-pound-experiment",
      participant_count: 13,
      amount_collected_minor: 1300,
      currency: "GBP",
      updated_at: "2026-07-13T12:01:00Z",
    } satisfies PublicExperimentStatsResponse;
    vi.mocked(api.getPublicExperimentStats)
      .mockResolvedValueOnce({
        campaign_slug: "the-one-pound-experiment",
        participant_count: 12,
        amount_collected_minor: 1200,
        currency: "GBP",
        updated_at: "2026-07-13T12:00:00Z",
      })
      .mockResolvedValueOnce(refreshedStats);

    renderPublicExperiment();

    await waitFor(() => {
      expect(screen.getByText("12 people said yes")).toBeInTheDocument();
    });

    window.dispatchEvent(new CustomEvent("public-experiment-stats-refresh"));

    await waitFor(() => {
      expect(screen.getByText("13 people said yes")).toBeInTheDocument();
      expect(screen.getByText(/13\.00 collected so far\./)).toBeInTheDocument();
    });
  });

  it("renders faq questions and allows expansion", () => {
    renderPublicExperiment();

    const summary = screen.getByText("What is this?");
    const details = summary.closest("details");
    expect(details).not.toHaveAttribute("open");

    fireEvent.click(summary);

    expect(details).toHaveAttribute("open");
  });
});

describe("Public source normalization", () => {
  it("applies the same normalization rules as the backend", () => {
    expect(normalizePublicSourceCode(null)).toBe("direct");
    expect(normalizePublicSourceCode("")).toBe("direct");
    expect(normalizePublicSourceCode(" TikTok_Ad ")).toBe("tiktok_ad");
    expect(normalizePublicSourceCode("newsletter")).toBe("newsletter");
    expect(normalizePublicSourceCode("bad.code")).toBe("direct");
    expect(normalizePublicSourceCode("bad code")).toBe("direct");
    expect(normalizePublicSourceCode("x".repeat(65))).toBe("direct");
  });
});

describe("Public referral normalization", () => {
  it("applies the same safe referral rules as the backend", () => {
    expect(normalizePublicReferralCode(null)).toBeNull();
    expect(normalizePublicReferralCode("")).toBeNull();
    expect(normalizePublicReferralCode(" r_ab12cd34 ")).toBe("r_ab12cd34");
    expect(normalizePublicReferralCode("r_BAD-Code_123")).toBe("r_bad-code_123");
    expect(normalizePublicReferralCode("badprefix")).toBeNull();
    expect(normalizePublicReferralCode("r_bad.code")).toBeNull();
  });
});

describe("Experiment thank-you page", () => {
  it("shows loading first and then verified success with sharing controls", async () => {
    renderThankYou();

    expect(screen.getByText("Verifying your participation...")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Thank you - you're part of the experiment.")).toBeInTheDocument();
      expect(screen.getByText("Your £1 participation was received successfully.")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "You said yes. Now ask someone else." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy your referral link" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Share your referral link on WhatsApp" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Share your referral link on X" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Share your referral link by email" })).toBeInTheDocument();
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
    expect(screen.getByText("We're still verifying the payment.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "You said yes. Now ask someone else." })).not.toBeInTheDocument();

    for (let index = 0; index < 4; index += 1) {
      await vi.advanceTimersByTimeAsync(1200);
    }

    expect(api.getPublicCheckoutStatus).toHaveBeenCalledTimes(4);
  });

  it("shows a safe error state for invalid or failed sessions", async () => {
    renderThankYou("/experiment/thank-you?session_id=invalid");

    await waitFor(() => {
      expect(screen.getByText("We couldn't confirm this session yet.")).toBeInTheDocument();
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
      expect(screen.getByText("This checkout didn't complete.")).toBeInTheDocument();
      expect(screen.getByText("No confirmed payment was recorded for this session.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "You said yes. Now ask someone else." })).not.toBeInTheDocument();
  });

  it("keeps the normalized source when linking back to the experiment page", async () => {
    renderThankYou("/experiment/thank-you?session_id=cs_test_123&source=%20TikTok_Ad%20");

    await waitFor(() => {
      expect(screen.getByText("Thank you - you're part of the experiment.")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "Back to the experiment page" })).toHaveAttribute(
      "href",
      "/experiment?source=tiktok_ad",
    );
  });

  it("shares the referral link without including the session id", async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: shareSpy });
    renderThankYou();

    await waitFor(() => {
      expect(screen.getByText("Thank you - you're part of the experiment.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy your referral link" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://localhost:5173/experiment?ref=r_share123");
      expect(screen.getByText("Link copied")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Share your referral link natively" }));
    await waitFor(() => {
      expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({
        title: "You said yes. Now ask someone else.",
        text: "I gave £1 to a simple internet experiment. Would you?",
        url: "http://localhost:5173/experiment?ref=r_share123",
      }));
    });

    expect(screen.getByRole("link", { name: "Share your referral link on WhatsApp" }).getAttribute("href")).toContain(
      encodeURIComponent("I gave £1 to a simple internet experiment. Would you? http://localhost:5173/experiment?ref=r_share123"),
    );
    expect(screen.getByRole("link", { name: "Share your referral link on X" }).getAttribute("href")).toContain(
      encodeURIComponent("http://localhost:5173/experiment?ref=r_share123"),
    );
    expect(screen.getByRole("link", { name: "Share your referral link by email" }).getAttribute("href")).toContain(
      encodeURIComponent("Would you try this £1 experiment?"),
    );
    expect(screen.getByRole("link", { name: "Share your referral link by email" }).getAttribute("href")).toContain(
      encodeURIComponent("http://localhost:5173/experiment?ref=r_share123"),
    );
    expect(screen.getByRole("link", { name: "Share your referral link on WhatsApp" }).getAttribute("href")).not.toContain("cs_test_123");
    expect(screen.getByRole("link", { name: "Share your referral link on X" }).getAttribute("href")).not.toContain("cs_test_123");
  });

  it("hides the native share button when navigator.share is unsupported", async () => {
    renderThankYou();

    await waitFor(() => {
      expect(screen.getByText("Thank you - you're part of the experiment.")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Share your referral link natively" })).not.toBeInTheDocument();
  });

  it("shows a safe clipboard fallback message when copying fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    renderThankYou();

    await waitFor(() => {
      expect(screen.getByText("Thank you - you're part of the experiment.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy your referral link" }));

    await waitFor(() => {
      expect(screen.getByText("Copy failed. You can still copy the share link manually.")).toBeInTheDocument();
    });
  });

  it("keeps polling until a completed paid session receives a referral code", async () => {
    const responses: PublicCheckoutStatusResponse[] = [
      {
        status: "completed",
        payment_status: "paid",
        amount_total_minor: 100,
        currency: "GBP",
        campaign_name: "The £1 Experiment",
        completed_at: "2026-07-13T12:00:00Z",
        referral_code: null,
      },
      {
        status: "completed",
        payment_status: "paid",
        amount_total_minor: 100,
        currency: "GBP",
        campaign_name: "The £1 Experiment",
        completed_at: "2026-07-13T12:00:00Z",
        referral_code: "r_share123",
      },
    ];
    vi.mocked(api.getPublicCheckoutStatus).mockImplementation(() => Promise.resolve(responses.shift() ?? responses[0]));

    renderThankYou();

    await waitFor(() => {
      expect(screen.getByText(/preparing your personal share link/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Copy your referral link" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "You said yes. Now ask someone else." })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy your referral link" })).toBeInTheDocument();
    }, { timeout: 3000 });
    expect(api.getPublicCheckoutStatus).toHaveBeenCalledTimes(2);
  });

  it("does not show sharing controls for completed sessions that are not paid", async () => {
    vi.mocked(api.getPublicCheckoutStatus).mockResolvedValueOnce({
      status: "completed",
      payment_status: "unpaid",
      amount_total_minor: 100,
      currency: "GBP",
      campaign_name: "The £1 Experiment",
      completed_at: "2026-07-13T12:00:00Z",
      referral_code: "r_share123",
    });

    renderThankYou();

    await waitFor(() => {
      expect(screen.getByText("Thank you - you're part of the experiment.")).toBeInTheDocument();
    });

    expect(screen.queryByRole("heading", { name: "You said yes. Now ask someone else." })).not.toBeInTheDocument();
  });

  it("handles native share cancellation quietly", async () => {
    const shareSpy = vi.fn().mockRejectedValue(new Error("cancelled"));
    Object.defineProperty(navigator, "share", { configurable: true, value: shareSpy });

    renderThankYou();

    await waitFor(() => {
      expect(screen.getByText("Thank you - you're part of the experiment.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Share your referral link natively" }));

    await waitFor(() => {
      expect(shareSpy).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/copy failed/i)).not.toBeInTheDocument();
  });
});
