import { FormEvent, useState } from "react";

import { CreativeVariantCreatePayload } from "../api/client";

type Props = {
  isSubmitting?: boolean;
  onSubmit: (payload: CreativeVariantCreatePayload) => Promise<void> | void;
  onCancel?: () => void;
};

const HOOK_TYPES = ["direct_question", "challenge", "statistic", "humour", "social_proof", "philosophical"];
const VISUAL_TYPES = ["surreal", "satisfying", "cinematic", "meme", "simulation", "fake_news", "abstract", "street_interview_style"];
const TONES = ["funny", "mysterious", "serious", "confrontational", "curious", "emotional"];
const TEXT_DENSITIES = ["low", "medium", "high"];

export function CreativeVariantForm({ isSubmitting = false, onSubmit, onCancel }: Props) {
  const [hookType, setHookType] = useState(HOOK_TYPES[0]);
  const [visualType, setVisualType] = useState(VISUAL_TYPES[0]);
  const [tone, setTone] = useState(TONES[0]);
  const [callToAction, setCallToAction] = useState("");
  const [videoLengthSeconds, setVideoLengthSeconds] = useState("15");
  const [voiceoverEnabled, setVoiceoverEnabled] = useState(false);
  const [textDensity, setTextDensity] = useState(TEXT_DENSITIES[0]);
  const [trackingCode, setTrackingCode] = useState("");
  const [formError, setFormError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const durationValue = Number(videoLengthSeconds);

    if (!hookType || !visualType || !tone || !callToAction.trim() || !trackingCode.trim()) {
      setFormError("Complete all required variant fields.");
      return;
    }
    if (!Number.isFinite(durationValue) || durationValue <= 0) {
      setFormError("Video length must be greater than zero.");
      return;
    }

    await onSubmit({
      hook_type: hookType,
      visual_type: visualType,
      tone,
      call_to_action: callToAction.trim(),
      video_length_seconds: durationValue,
      voiceover_enabled: voiceoverEnabled,
      text_density: textDensity,
      tracking_code: trackingCode.trim(),
      experiment_config_json: {},
    });
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field">
          <span>Hook Type</span>
          <select aria-label="Hook type" value={hookType} onChange={(event) => setHookType(event.target.value)}>
            {HOOK_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Visual Type</span>
          <select aria-label="Visual type" value={visualType} onChange={(event) => setVisualType(event.target.value)}>
            {VISUAL_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Tone</span>
          <select aria-label="Tone" value={tone} onChange={(event) => setTone(event.target.value)}>
            {TONES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Text Density</span>
          <select aria-label="Text density" value={textDensity} onChange={(event) => setTextDensity(event.target.value)}>
            {TEXT_DENSITIES.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Video Length In Seconds</span>
          <input aria-label="Video length in seconds" type="number" min="1" step="1" value={videoLengthSeconds} onChange={(event) => setVideoLengthSeconds(event.target.value)} />
        </label>
        <label className="field">
          <span>Tracking Code</span>
          <input aria-label="Tracking code" value={trackingCode} onChange={(event) => setTrackingCode(event.target.value)} />
        </label>
        <label className="field field-wide">
          <span>Call To Action</span>
          <textarea aria-label="Call to action" value={callToAction} onChange={(event) => setCallToAction(event.target.value)} />
        </label>
        <label className="toggle-chip">
          <input aria-label="Voiceover enabled" type="checkbox" checked={voiceoverEnabled} onChange={(event) => setVoiceoverEnabled(event.target.checked)} />
          <span>Voiceover enabled</span>
        </label>
      </div>
      {formError ? <p className="error">{formError}</p> : null}
      <div className="button-row">
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Create variant"}</button>
        {onCancel ? <button className="secondary" type="button" onClick={onCancel}>Cancel</button> : null}
      </div>
    </form>
  );
}
