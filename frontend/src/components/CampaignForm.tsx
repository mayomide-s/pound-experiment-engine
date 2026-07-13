import { FormEvent, useMemo, useState } from "react";

import { Campaign, CampaignCreatePayload, CampaignStatus } from "../api/client";

type Props = {
  initialValues?: Partial<Campaign>;
  submitLabel?: string;
  isSubmitting?: boolean;
  onSubmit: (payload: CampaignCreatePayload) => Promise<void> | void;
  onCancel?: () => void;
};

const PLATFORM_OPTIONS = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
];

const STATUS_OPTIONS: CampaignStatus[] = ["draft", "active", "paused", "completed"];

function minorToMajorString(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "1.00";
  }
  return (value / 100).toFixed(2);
}

export function CampaignForm({
  initialValues,
  submitLabel = "Create campaign",
  isSubmitting = false,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [slug, setSlug] = useState(initialValues?.slug ?? "");
  const [coreQuestion, setCoreQuestion] = useState(initialValues?.core_question ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [landingPageUrl, setLandingPageUrl] = useState(initialValues?.landing_page_url ?? "");
  const [currency, setCurrency] = useState(initialValues?.currency ?? "GBP");
  const [targetAmountMajor, setTargetAmountMajor] = useState(minorToMajorString(initialValues?.target_amount_minor));
  const [targetReach, setTargetReach] = useState(String(initialValues?.target_reach ?? 10000000));
  const [status, setStatus] = useState<CampaignStatus>(initialValues?.status ?? "draft");
  const [platforms, setPlatforms] = useState<string[]>(initialValues?.target_platforms_json ?? ["tiktok", "instagram", "youtube"]);
  const [formError, setFormError] = useState("");

  const selectedPlatforms = useMemo(() => new Set(platforms), [platforms]);

  function togglePlatform(platform: string) {
    setPlatforms((current) => (
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform]
    ));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    const trimmedQuestion = coreQuestion.trim();
    const amountValue = Number(targetAmountMajor);
    const reachValue = Number(targetReach);

    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }
    if (!trimmedSlug) {
      setFormError("Slug is required.");
      return;
    }
    if (!trimmedQuestion) {
      setFormError("Core question is required.");
      return;
    }
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setFormError("Target amount must be positive.");
      return;
    }
    if (!Number.isFinite(reachValue) || reachValue <= 0) {
      setFormError("Target reach must be positive.");
      return;
    }
    if (platforms.length === 0) {
      setFormError("Select at least one target platform.");
      return;
    }

    await onSubmit({
      name: trimmedName,
      slug: trimmedSlug,
      core_question: trimmedQuestion,
      description: description.trim() || null,
      landing_page_url: landingPageUrl.trim() || null,
      currency: currency.trim().toUpperCase(),
      target_amount_minor: Math.round(amountValue * 100),
      target_reach: Math.round(reachValue),
      status,
      target_platforms_json: platforms,
      content_rules_json: initialValues?.content_rules_json ?? {},
      start_date: initialValues?.start_date ?? null,
      end_date: initialValues?.end_date ?? null,
    });
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input aria-label="Campaign name" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Slug</span>
          <input aria-label="Campaign slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
        </label>
        <label className="field field-wide">
          <span>Core Question</span>
          <input aria-label="Core question" value={coreQuestion} onChange={(event) => setCoreQuestion(event.target.value)} />
        </label>
        <label className="field field-wide">
          <span>Description</span>
          <textarea aria-label="Campaign description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className="field field-wide">
          <span>Landing Page URL</span>
          <input aria-label="Landing page URL" value={landingPageUrl} onChange={(event) => setLandingPageUrl(event.target.value)} placeholder="https://example.com" />
        </label>
        <label className="field">
          <span>Currency</span>
          <input aria-label="Currency" value={currency} onChange={(event) => setCurrency(event.target.value)} maxLength={3} />
        </label>
        <label className="field">
          <span>Target Amount</span>
          <input aria-label="Target amount" type="number" min="0.01" step="0.01" value={targetAmountMajor} onChange={(event) => setTargetAmountMajor(event.target.value)} />
        </label>
        <label className="field">
          <span>Target Reach</span>
          <input aria-label="Target reach" type="number" min="1" step="1" value={targetReach} onChange={(event) => setTargetReach(event.target.value)} />
        </label>
        <label className="field">
          <span>Status</span>
          <select aria-label="Campaign status" value={status} onChange={(event) => setStatus(event.target.value as CampaignStatus)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <div className="field field-wide">
          <span>Target Platforms</span>
          <div className="toggle-row">
            {PLATFORM_OPTIONS.map((platform) => (
              <label key={platform.value} className="toggle-chip">
                <input
                  aria-label={platform.label}
                  type="checkbox"
                  checked={selectedPlatforms.has(platform.value)}
                  onChange={() => togglePlatform(platform.value)}
                />
                <span>{platform.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      {formError ? <p className="error">{formError}</p> : null}
      <div className="button-row">
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : submitLabel}</button>
        {onCancel ? <button className="secondary" type="button" onClick={onCancel}>Cancel</button> : null}
      </div>
    </form>
  );
}
