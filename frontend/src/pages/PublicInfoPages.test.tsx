import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactPage } from "./ContactPage";
import { PrivacyPage } from "./PrivacyPage";
import { RefundsPage } from "./RefundsPage";
import { TermsPage } from "./TermsPage";

function renderPublicInfoPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/refunds" element={<RefundsPage />} />
        <Route path="/contact" element={<ContactPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_PUBLIC_CONTACT_EMAIL", "support@example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Public information pages", () => {
  it("renders privacy, terms, refunds, and contact routes", () => {
    renderPublicInfoPage("/privacy");
    expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();

    renderPublicInfoPage("/terms");
    expect(screen.getByRole("heading", { name: "Terms" })).toBeInTheDocument();

    renderPublicInfoPage("/refunds");
    expect(screen.getByRole("heading", { name: "Refund Policy" })).toBeInTheDocument();

    renderPublicInfoPage("/contact");
    expect(screen.getByRole("heading", { name: "Contact" })).toBeInTheDocument();
  });

  it("renders the configured contact email with mailto links", () => {
    renderPublicInfoPage("/contact");

    const links = screen.getAllByRole("link", { name: "support@example.com" });
    expect(links.length).toBeGreaterThan(0);
    links.forEach((link) => {
      expect(link).toHaveAttribute("href", "mailto:support@example.com");
    });
  });

  it("shows a safe fallback when the contact email is missing", () => {
    vi.stubEnv("VITE_PUBLIC_CONTACT_EMAIL", "");
    renderPublicInfoPage("/contact");

    expect(screen.getAllByText("Contact details temporarily unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /temporarily unavailable/i })).not.toBeInTheDocument();
  });

  it("shows the safe fallback for malformed contact email values", () => {
    vi.stubEnv("VITE_PUBLIC_CONTACT_EMAIL", " javascript:alert(1)@example.com?subject=oops ");
    renderPublicInfoPage("/contact");

    expect(screen.getAllByText("Contact details temporarily unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /javascript:alert/i })).not.toBeInTheDocument();
  });

  it("links back to the experiment from public policy pages", () => {
    renderPublicInfoPage("/privacy");

    expect(screen.getByRole("link", { name: "Back to the experiment" })).toHaveAttribute("href", "/experiment");
  });

  it("does not describe the payment as a charitable donation and keeps refund guidance safe", () => {
    renderPublicInfoPage("/terms");
    expect(screen.getAllByText(/not a charitable donation/i).length).toBeGreaterThan(0);

    renderPublicInfoPage("/refunds");
    expect(screen.getByText(/Do not send card numbers/i)).toBeInTheDocument();
  });
});
