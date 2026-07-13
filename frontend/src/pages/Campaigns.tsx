import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  api,
  Campaign,
  CampaignCreatePayload,
  CreativeVariant,
  CreativeVariantCreatePayload,
} from "../api/client";
import { CampaignDetail } from "../components/CampaignDetail";
import { CampaignForm } from "../components/CampaignForm";
import { CreativeVariantForm } from "../components/CreativeVariantForm";

const POUND_EXPERIMENT_PREFILL: CampaignCreatePayload = {
  name: "The \u00a31 Experiment",
  slug: "the-one-pound-experiment",
  core_question: "Would you give a stranger \u00a31?",
  description: "A transparent internet social experiment measuring what percentage of people voluntarily send \u00a31 to a stranger simply because they were asked.",
  landing_page_url: null,
  currency: "GBP",
  target_amount_minor: 100,
  target_reach: 10000000,
  status: "draft",
  target_platforms_json: ["tiktok", "instagram", "youtube"],
  content_rules_json: {},
  start_date: null,
  end_date: null,
};

function formatCreatedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [variants, setVariants] = useState<CreativeVariant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  const [showCreateVariant, setShowCreateVariant] = useState(false);
  const [campaignSubmitError, setCampaignSubmitError] = useState("");
  const [variantSubmitError, setVariantSubmitError] = useState("");
  const [runSuccessRunId, setRunSuccessRunId] = useState<string | null>(null);
  const [isCampaignSubmitting, setIsCampaignSubmitting] = useState(false);
  const [isVariantSubmitting, setIsVariantSubmitting] = useState(false);
  const [campaignFormSeed, setCampaignFormSeed] = useState<Partial<Campaign> | undefined>(undefined);

  const selectedCampaignSummary = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null,
    [campaigns, selectedCampaignId],
  );

  async function loadCampaigns(preferredCampaignId?: string | null) {
    setIsLoading(true);
    setError("");
    try {
      const response = await api.listCampaigns();
      setCampaigns(response.items);
      const nextSelection = preferredCampaignId
        ?? selectedCampaignId
        ?? response.items[0]?.id
        ?? null;
      setSelectedCampaignId(nextSelection);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaigns.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadCampaignDetail(campaignId: string) {
    setDetailLoading(true);
    setError("");
    try {
      const [campaign, variantList] = await Promise.all([
        api.getCampaign(campaignId),
        api.listCreativeVariants(campaignId),
      ]);
      setSelectedCampaign(campaign);
      setVariants(variantList);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaign detail.");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadCampaigns().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedCampaignId) {
      setSelectedCampaign(null);
      setVariants([]);
      return;
    }
    loadCampaignDetail(selectedCampaignId).catch(() => undefined);
  }, [selectedCampaignId]);

  async function handleCreateCampaign(payload: CampaignCreatePayload) {
    setIsCampaignSubmitting(true);
    setCampaignSubmitError("");
    try {
      const campaign = await api.createCampaign(payload);
      setShowCreateCampaign(false);
      setCampaignFormSeed(undefined);
      await loadCampaigns(campaign.id);
    } catch (submitError) {
      setCampaignSubmitError(submitError instanceof Error ? submitError.message : "Failed to create campaign.");
    } finally {
      setIsCampaignSubmitting(false);
    }
  }

  async function handleCreateVariant(payload: CreativeVariantCreatePayload) {
    if (!selectedCampaignId) {
      return;
    }
    setIsVariantSubmitting(true);
    setVariantSubmitError("");
    try {
      await api.createCreativeVariant(selectedCampaignId, payload);
      setShowCreateVariant(false);
      await loadCampaignDetail(selectedCampaignId);
    } catch (submitError) {
      setVariantSubmitError(submitError instanceof Error ? submitError.message : "Failed to create variant.");
    } finally {
      setIsVariantSubmitting(false);
    }
  }

  async function handleCreateRunFromVariant(payload: Parameters<typeof api.createRun>[0]) {
    const response = await api.createRun(payload);
    const runId = String(response.pipeline_run.id);
    setRunSuccessRunId(runId);
    if (selectedCampaignId) {
      await loadCampaignDetail(selectedCampaignId);
    }
    return { runId };
  }

  function openPrefilledPoundExperiment() {
    setCampaignFormSeed({
      name: POUND_EXPERIMENT_PREFILL.name,
      slug: POUND_EXPERIMENT_PREFILL.slug,
      core_question: POUND_EXPERIMENT_PREFILL.core_question,
      description: POUND_EXPERIMENT_PREFILL.description ?? undefined,
      landing_page_url: POUND_EXPERIMENT_PREFILL.landing_page_url ?? undefined,
      currency: POUND_EXPERIMENT_PREFILL.currency,
      target_amount_minor: POUND_EXPERIMENT_PREFILL.target_amount_minor,
      target_reach: POUND_EXPERIMENT_PREFILL.target_reach,
      status: POUND_EXPERIMENT_PREFILL.status,
      target_platforms_json: POUND_EXPERIMENT_PREFILL.target_platforms_json,
      content_rules_json: POUND_EXPERIMENT_PREFILL.content_rules_json,
    });
    setShowCreateCampaign(true);
  }

  return (
    <div className="page">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Campaigns</p>
            <h2>Campaign workflow</h2>
          </div>
          <button type="button" onClick={() => { setCampaignFormSeed(undefined); setShowCreateCampaign(true); }}>
            Create campaign
          </button>
        </div>
        <p className="subtle">Create experiments, control creative variants, and launch linked pipeline runs without changing the existing Story Engine flow.</p>
      </section>

      {runSuccessRunId ? (
        <div className="notice-card success-tone">
          <strong>Created run {runSuccessRunId}</strong>
          <div className="button-row">
            <Link className="inline-link" to={`/?run=${runSuccessRunId}`}>Open Dashboard</Link>
          </div>
        </div>
      ) : null}

      {showCreateCampaign ? (
        <section className="panel stack">
          <div className="panel-header">
            <h3>Create campaign</h3>
          </div>
          <CampaignForm
            initialValues={campaignFormSeed}
            submitLabel="Create campaign"
            isSubmitting={isCampaignSubmitting}
            onSubmit={handleCreateCampaign}
            onCancel={() => {
              setShowCreateCampaign(false);
              setCampaignSubmitError("");
              setCampaignFormSeed(undefined);
            }}
          />
          {campaignSubmitError ? <p className="error">{campaignSubmitError}</p> : null}
        </section>
      ) : null}

      <div className="dashboard-grid campaigns-grid">
        <section className="panel stack">
          <div className="panel-header">
            <h3>Existing campaigns</h3>
            <span>{campaigns.length}</span>
          </div>
          {isLoading ? <p className="subtle">Loading campaigns...</p> : null}
          {!isLoading && error ? <p className="error">{error}</p> : null}
          {!isLoading && !error && campaigns.length === 0 ? (
            <div className="notice-card">
              <strong>No campaigns yet</strong>
              <p>Start with a new experiment or prefill the initial \u00a31 campaign.</p>
              <div className="button-row">
                <button type="button" onClick={openPrefilledPoundExperiment}>Create The \u00a31 Experiment</button>
              </div>
            </div>
          ) : null}
          {!isLoading && campaigns.length > 0 ? (
            <div className="list">
              {campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  className={`run-card-button campaign-list-button ${selectedCampaignId === campaign.id ? "campaign-list-button-active" : ""}`}
                  onClick={() => {
                    setRunSuccessRunId(null);
                    setSelectedCampaignId(campaign.id);
                  }}
                >
                  <div className="panel-header">
                    <strong>{campaign.name}</strong>
                    <span className={`status-pill ${campaign.status === "active" ? "success" : "muted"}`}>{campaign.status}</span>
                  </div>
                  <p>{campaign.core_question}</p>
                  <div className="key-grid campaign-summary-grid">
                    <div><span>Reach</span><strong>{campaign.target_reach.toLocaleString()}</strong></div>
                    <div><span>Platforms</span><strong>{campaign.target_platforms_json.join(", ")}</strong></div>
                    <div><span>Created</span><strong>{formatCreatedDate(campaign.created_at)}</strong></div>
                  </div>
                  <span className="inline-link">Open campaign detail</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <div className="stack">
          {detailLoading ? <section className="panel"><p className="subtle">Loading campaign detail...</p></section> : null}
          {!detailLoading && selectedCampaign ? (
            <>
              <CampaignDetail campaign={selectedCampaign} variants={variants} onCreateRun={handleCreateRunFromVariant} />
              <section className="panel stack">
                <div className="panel-header">
                  <h3>Create creative variant</h3>
                  {selectedCampaignSummary ? <span>{selectedCampaignSummary.name}</span> : null}
                </div>
                {showCreateVariant ? (
                  <>
                    <CreativeVariantForm
                      isSubmitting={isVariantSubmitting}
                      onSubmit={handleCreateVariant}
                      onCancel={() => {
                        setShowCreateVariant(false);
                        setVariantSubmitError("");
                      }}
                    />
                    {variantSubmitError ? <p className="error">{variantSubmitError}</p> : null}
                  </>
                ) : (
                  <div className="button-row">
                    <button type="button" onClick={() => setShowCreateVariant(true)}>Create variant</button>
                  </div>
                )}
              </section>
            </>
          ) : null}
          {!detailLoading && !selectedCampaign && campaigns.length > 0 ? (
            <section className="panel">
              <p className="subtle">Select a campaign to inspect its detail and variants.</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
