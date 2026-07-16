import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { AdminExperimentAnalyticsResponse } from "../api/client";
import { validateSourceCode } from "../public/source";
import {
  BEST_CONVERSION_MIN_STARTS,
  LAUNCH_PRESETS,
  buildLaunchShareTargets,
  buildLaunchSourceCode,
  buildLaunchSummary,
  buildSourcePerformanceCsv,
  buildSourcePerformanceRows,
  createLaunchNote,
  filterSourcePerformanceRows,
  loadLaunchNotes,
  saveLaunchNotes,
  type LaunchNote,
  type LaunchNoteStatus,
} from "../utils/launchToolkit";

type LaunchToolkitPanelProps = {
  analytics: AdminExperimentAnalyticsResponse;
};

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

type CopyState = "idle" | "success" | "error";

export function LaunchToolkitPanel({ analytics }: LaunchToolkitPanelProps) {
  const [sourceName, setSourceName] = useState("");
  const [campaignLabel, setCampaignLabel] = useState("");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "with-completed" | "zero-completed">("all");
  const [launchNotes, setLaunchNotes] = useState<LaunchNote[]>(() => loadLaunchNotes());
  const [notesAnnouncement, setNotesAnnouncement] = useState("");
  const validationMessageId = useId();
  const copyStatusTimeoutRef = useRef<number | null>(null);
  const notesStatusTimeoutRef = useRef<number | null>(null);
  const rows = useMemo(() => buildSourcePerformanceRows(analytics), [analytics]);
  const filteredRows = useMemo(
    () => filterSourcePerformanceRows(rows, searchTerm, statusFilter),
    [rows, searchTerm, statusFilter],
  );
  const summary = useMemo(() => buildLaunchSummary(rows), [rows]);
  const generatedSource = useMemo(
    () => buildLaunchSourceCode(sourceName, campaignLabel),
    [sourceName, campaignLabel],
  );
  const shareTargets = useMemo(
    () => (generatedSource.sourceCode ? buildLaunchShareTargets(generatedSource.sourceCode) : null),
    [generatedSource.sourceCode],
  );
  const bestConversionRow = useMemo(() => rows.find((row) => row.source_code === summary.bestConversionSource) ?? null, [rows, summary.bestConversionSource]);

  useEffect(() => {
    saveLaunchNotes(launchNotes);
  }, [launchNotes]);

  useEffect(() => () => {
    if (copyStatusTimeoutRef.current) {
      window.clearTimeout(copyStatusTimeoutRef.current);
    }
    if (notesStatusTimeoutRef.current) {
      window.clearTimeout(notesStatusTimeoutRef.current);
    }
  }, []);

  function setTransientState(
    setter: (value: CopyState) => void,
    value: CopyState,
    ref: { current: number | null },
    resetDelay = 1800,
  ) {
    setter(value);
    if (ref.current) {
      window.clearTimeout(ref.current);
    }
    ref.current = window.setTimeout(() => setter("idle"), resetDelay);
  }

  function announceNotes(message: string) {
    setNotesAnnouncement(message);
    if (notesStatusTimeoutRef.current) {
      window.clearTimeout(notesStatusTimeoutRef.current);
    }
    notesStatusTimeoutRef.current = window.setTimeout(() => setNotesAnnouncement(""), 1800);
  }

  async function handleCopyLink() {
    if (!shareTargets) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareTargets.launchUrl);
      setTransientState(setCopyState, "success", copyStatusTimeoutRef);
    } catch {
      setTransientState(setCopyState, "error", copyStatusTimeoutRef);
    }
  }

  function handleExportCsv() {
    const { csv, filename } = buildSourcePerformanceCsv(filteredRows, analytics.currency);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.click();
    window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 0);
  }

  function updateLaunchNote(noteId: string, updater: (note: LaunchNote) => LaunchNote) {
    setLaunchNotes((current) => current.map((note) => (note.id === noteId ? updater(note) : note)));
  }

  function handleAddNote() {
    setLaunchNotes((current) => [...current, createLaunchNote(generatedSource.sourceCode ?? "direct")]);
    announceNotes("Launch note added.");
  }

  function handleDeleteNote(noteId: string) {
    setLaunchNotes((current) => current.filter((note) => note.id !== noteId));
    announceNotes("Launch note removed.");
  }

  return (
    <section className="public-card launch-toolkit-panel">
      <div className="panel-header">
        <div>
          <h2>Launch Toolkit</h2>
          <p className="subtle">Generate source links, compare channel performance, and keep private launch notes in this browser only.</p>
        </div>
        <button
          className="secondary"
          type="button"
          onClick={handleExportCsv}
          disabled={filteredRows.length === 0}
        >
          Export CSV
        </button>
      </div>
      <div className="launch-toolkit-grid">
        <article className="copy-block">
          <h3>Source-Link Generator</h3>
          <div className="toggle-row launch-preset-row" role="group" aria-label="Launch channel presets">
            {LAUNCH_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className={sourceName === preset.sourceCode ? "secondary launch-preset active" : "secondary launch-preset"}
                type="button"
                onClick={() => setSourceName(preset.sourceCode)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="form-grid launch-form-grid">
            <label className="field">
              <span>Source name</span>
              <input
                aria-describedby={generatedSource.error ? validationMessageId : undefined}
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                placeholder="tiktok"
              />
            </label>
            <label className="field">
              <span>Campaign label</span>
              <input
                aria-describedby={generatedSource.error ? validationMessageId : undefined}
                value={campaignLabel}
                onChange={(event) => setCampaignLabel(event.target.value)}
                placeholder="launch_1"
              />
            </label>
          </div>
          {generatedSource.error ? (
            <p className="error" id={validationMessageId}>{generatedSource.error}</p>
          ) : null}
          <div className="preview-block launch-preview-block">
            <span>Generated source code</span>
            <strong>{generatedSource.sourceCode ?? "No launch link yet"}</strong>
            <span className="launch-url-preview">{shareTargets?.launchUrl ?? "Enter a valid source to generate a launch link."}</span>
          </div>
          <div className="button-row">
            <button type="button" onClick={handleCopyLink} disabled={!shareTargets}>
              {copyState === "success" ? "Link copied" : "Copy link"}
            </button>
            <a
              className={`inline-link ${shareTargets ? "" : "disabled-link"}`}
              href={shareTargets?.launchUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!shareTargets}
              onClick={(event) => {
                if (!shareTargets) {
                  event.preventDefault();
                }
              }}
            >
              Open link
            </a>
            <a
              className={`inline-link ${shareTargets ? "" : "disabled-link"}`}
              href={shareTargets?.whatsappUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!shareTargets}
              onClick={(event) => {
                if (!shareTargets) {
                  event.preventDefault();
                }
              }}
            >
              Share on WhatsApp
            </a>
            <a
              className={`inline-link ${shareTargets ? "" : "disabled-link"}`}
              href={shareTargets?.twitterUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!shareTargets}
              onClick={(event) => {
                if (!shareTargets) {
                  event.preventDefault();
                }
              }}
            >
              Share on X/Twitter
            </a>
            <a
              className={`inline-link ${shareTargets ? "" : "disabled-link"}`}
              href={shareTargets?.emailUrl ?? "#"}
              aria-disabled={!shareTargets}
              onClick={(event) => {
                if (!shareTargets) {
                  event.preventDefault();
                }
              }}
            >
              Share by email
            </a>
          </div>
          <p className="subtle" role="status" aria-live="polite">
            {copyState === "success" ? "Launch link copied." : copyState === "error" ? "Clipboard access failed. You can still open or share the link directly." : ""}
          </p>
        </article>
        <article className="copy-block">
          <h3>Launch Summary</h3>
          <div className="key-grid">
            <div><span>Total starts</span><strong>{analytics.checkout_sessions_started}</strong></div>
            <div><span>Completed payments</span><strong>{analytics.completed_payments}</strong></div>
            <div><span>Overall conversion</span><strong>{(analytics.conversion_rate * 100).toFixed(1)}%</strong></div>
            <div><span>Amount collected</span><strong>{formatMoney(analytics.amount_collected_minor, analytics.currency)}</strong></div>
            <div><span>Active sources</span><strong>{summary.activeSourceCount}</strong></div>
            <div><span>Best performing</span><strong>{summary.bestPerformingSource ?? "Not enough data yet"}</strong></div>
            <div>
              <span>Best conversion</span>
              <strong>
                {bestConversionRow
                  ? `${bestConversionRow.source_code} (${(bestConversionRow.conversionRate * 100).toFixed(1)}%)`
                  : "Not enough data yet"}
              </strong>
            </div>
          </div>
          <p className="subtle">
            Best conversion requires at least {BEST_CONVERSION_MIN_STARTS} checkout starts before a source is highlighted.
          </p>
        </article>
      </div>
      <article className="copy-block">
        <div className="panel-header">
          <div>
            <h3>Source Performance</h3>
            <p className="subtle">Compare source starts, paid completions, conversion, and contribution to total paid checkouts.</p>
          </div>
        </div>
        <div className="form-grid launch-filter-grid">
          <label className="field">
            <span>Search sources</span>
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by source code" />
          </label>
          <label className="field">
            <span>Filter</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "with-completed" | "zero-completed")}>
              <option value="all">Show all</option>
              <option value="with-completed">With completed payments</option>
              <option value="zero-completed">Zero completed payments</option>
            </select>
          </label>
        </div>
        {rows.length === 0 ? (
          <p className="subtle">No source analytics yet.</p>
        ) : filteredRows.length === 0 ? (
          <p className="subtle">No sources match the current filter.</p>
        ) : (
          <div className="table-scroll">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Started</th>
                  <th>Paid</th>
                  <th>Conversion</th>
                  <th>Share of paid</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.source_code}>
                    <td>{row.source_code}</td>
                    <td>{row.checkout_sessions_started}</td>
                    <td>{row.completed_payments}</td>
                    <td>{(row.conversionRate * 100).toFixed(1)}%</td>
                    <td>{(row.percentageOfCompletedPayments * 100).toFixed(1)}%</td>
                    <td>{formatMoney(row.amount_collected_minor, analytics.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
      <article className="copy-block">
        <div className="panel-header">
          <div>
            <h3>Launch Notes</h3>
            <p className="subtle">Stored locally in this browser only. These notes are not synchronized and should not contain secrets or customer data.</p>
          </div>
          <button type="button" className="secondary" onClick={handleAddNote}>Add note</button>
        </div>
        {launchNotes.length === 0 ? (
          <p className="subtle">No launch notes yet.</p>
        ) : (
          <div className="launch-notes-list">
            {launchNotes.map((note, index) => (
              <fieldset className="panel inset launch-note-card" key={note.id}>
                <legend>Launch note {index + 1}</legend>
                <div className="form-grid launch-note-grid">
                  <label className="field">
                    <span>Channel</span>
                    <input
                      value={note.channel}
                      onChange={(event) => updateLaunchNote(note.id, (current) => ({ ...current, channel: event.target.value }))}
                      placeholder="TikTok account"
                    />
                  </label>
                  <label className="field">
                    <span>Planned post date</span>
                    <input
                      type="date"
                      value={note.plannedPostDate}
                      onChange={(event) => updateLaunchNote(note.id, (current) => ({ ...current, plannedPostDate: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    <span>Source code</span>
                    <input
                      value={note.sourceCode}
                      onChange={(event) => {
                        const nextValue = event.target.value.toLowerCase();
                        if (nextValue === "" || /^[a-z0-9_-]{0,64}$/.test(nextValue)) {
                          updateLaunchNote(note.id, (current) => ({ ...current, sourceCode: nextValue }));
                        }
                      }}
                      onBlur={() => {
                        updateLaunchNote(note.id, (current) => ({
                          ...current,
                          sourceCode: validateSourceCode(current.sourceCode) ?? "direct",
                        }));
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={note.status}
                      onChange={(event) => updateLaunchNote(note.id, (current) => ({ ...current, status: event.target.value as LaunchNoteStatus }))}
                    >
                      <option value="planned">Planned</option>
                      <option value="posted">Posted</option>
                      <option value="paused">Paused</option>
                      <option value="complete">Complete</option>
                    </select>
                  </label>
                  <label className="field field-wide">
                    <span>Notes</span>
                    <textarea
                      rows={3}
                      value={note.notes}
                      onChange={(event) => updateLaunchNote(note.id, (current) => ({ ...current, notes: event.target.value }))}
                      placeholder="Timing, creative angle, or follow-up notes"
                    />
                  </label>
                </div>
                <div className="button-row">
                  <button className="secondary" type="button" onClick={() => handleDeleteNote(note.id)}>Delete note</button>
                </div>
              </fieldset>
            ))}
          </div>
        )}
        <p className="subtle" role="status" aria-live="polite">{notesAnnouncement}</p>
      </article>
    </section>
  );
}
