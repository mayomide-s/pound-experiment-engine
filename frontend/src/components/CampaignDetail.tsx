import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { Campaign, CreativeVariant, PipelineRunCreatePayload } from "../api/client";
import { PRIORITIES, STYLE_PRESETS } from "../constants";

type Props = {
  campaign: Campaign;
  variants: CreativeVariant[];
  onCreateRun: (payload: PipelineRunCreatePayload) => Promise<{ runId: string }>;
  onRefreshRequested?: () => void;
};

function formatDate(value?: string | null) {
  if (!value) {
    return "Not set";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTargetAmount(campaign: Campaign) {
  return `${campaign.currency} ${(campaign.target_amount_minor / 100).toFixed(2)}`;
}

function VariantRunPanel({
  campaign,
  variant,
  onCreateRun,
}: {
  campaign: Campaign;
  variant: CreativeVariant;
  onCreateRun: (payload: PipelineRunCreatePayload) => Promise<{ runId: string }>;
}) {
  const [topic, setTopic] = useState(campaign.core_question);
  const [stylePreset, setStylePreset] = useState(STYLE_PRESETS[0]);
  const [priority, setPriority] = useState("normal");
  const [autoMode, setAutoMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdRunId, setCreatedRunId] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      const result = await onCreateRun({
        campaign_id: campaign.id,
        creative_variant_id: variant.id,
        topic: topic.trim() || campaign.core_question,
        style_preset: stylePreset,
        priority,
        auto_mode: autoMode,
      });
      setCreatedRunId(result.runId);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create run.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <details className="technical-disclosure variant-run-panel">
      <summary>Create run</summary>
      <form className="stack compact" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field field-wide">
            <span>Topic</span>
            <input aria-label={`Topic for ${variant.tracking_code}`} value={topic} onChange={(event) => setTopic(event.target.value)} />
          </label>
          <label className="field">
            <span>Style Preset</span>
            <select aria-label={`Style preset for ${variant.tracking_code}`} value={stylePreset} onChange={(event) => setStylePreset(event.target.value)}>
              {STYLE_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Priority</span>
            <select aria-label={`Priority for ${variant.tracking_code}`} value={priority} onChange={(event) => setPriority(event.target.value)}>
              {PRIORITIES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="toggle-chip">
            <input aria-label={`Auto mode for ${variant.tracking_code}`} type="checkbox" checked={autoMode} onChange={(event) => setAutoMode(event.target.checked)} />
            <span>Auto mode</span>
          </label>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {createdRunId ? (
          <div className="notice-card">
            <strong>Run created</strong>
            <p>New run ID: <code>{createdRunId}</code></p>
            <div className="button-row">
              <Link className="inline-link" to={`/?run=${createdRunId}`}>Open Dashboard</Link>
            </div>
          </div>
        ) : null}
        <div className="button-row">
          <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating..." : "Create run"}</button>
        </div>
      </form>
    </details>
  );
}

export function CampaignDetail({ campaign, variants, onCreateRun }: Props) {
  return (
    <section className="panel stack">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Campaign Detail</p>
          <h2>{campaign.name}</h2>
        </div>
        <span className={`status-pill ${campaign.status === "active" ? "success" : campaign.status === "paused" ? "warning" : "muted"}`}>
          {campaign.status}
        </span>
      </div>
      <div className="key-grid">
        <div><span>Slug</span><strong>{campaign.slug}</strong></div>
        <div><span>Currency</span><strong>{campaign.currency}</strong></div>
        <div><span>Target Amount</span><strong>{formatTargetAmount(campaign)}</strong></div>
        <div><span>Target Reach</span><strong>{campaign.target_reach.toLocaleString()}</strong></div>
        <div><span>Platforms</span><strong>{campaign.target_platforms_json.join(", ") || "None"}</strong></div>
        <div><span>Landing Page</span><strong>{campaign.landing_page_url ? campaign.landing_page_url : "Not set"}</strong></div>
        <div><span>Start Date</span><strong>{formatDate(campaign.start_date)}</strong></div>
        <div><span>End Date</span><strong>{formatDate(campaign.end_date)}</strong></div>
        <div><span>Created</span><strong>{formatDate(campaign.created_at)}</strong></div>
        <div><span>Updated</span><strong>{formatDate(campaign.updated_at)}</strong></div>
      </div>
      <div className="content-card">
        <span>Core Question</span>
        <strong>{campaign.core_question}</strong>
        {campaign.description ? <p>{campaign.description}</p> : <p className="subtle">No description provided.</p>}
      </div>
      <div className="stack compact">
        <div className="panel-header">
          <h3>Creative Variants</h3>
          <span>{variants.length}</span>
        </div>
        {variants.length === 0 ? (
          <p className="subtle">No creative variants yet.</p>
        ) : (
          <div className="list">
            {variants.map((variant) => (
              <article key={variant.id} className="content-card variant-card">
                <div className="panel-header">
                  <div>
                    <strong>{variant.tracking_code}</strong>
                    <p className="subtle">Hook: {variant.hook_type} • Visual: {variant.visual_type}</p>
                  </div>
                  <span className="status-pill muted">{variant.tone}</span>
                </div>
                <div className="key-grid">
                  <div><span>Text Density</span><strong>{variant.text_density ?? "Not set"}</strong></div>
                  <div><span>Video Length</span><strong>{variant.video_length_seconds ? `${variant.video_length_seconds}s` : "Not set"}</strong></div>
                  <div><span>Voiceover</span><strong>{variant.voiceover_enabled ? "Enabled" : "Disabled"}</strong></div>
                  <div><span>Created</span><strong>{formatDate(variant.created_at)}</strong></div>
                </div>
                <div>
                  <span>Call To Action</span>
                  <p>{variant.call_to_action}</p>
                </div>
                <VariantRunPanel campaign={campaign} variant={variant} onCreateRun={onCreateRun} />
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
