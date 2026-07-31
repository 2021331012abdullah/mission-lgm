import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { Lock, Plus, Save, Trash2, X, Cloud, CheckCircle2, RefreshCw, Wand2, Hash } from "lucide-react";
import type { Problem, TrackerDay } from "@/data/tracker";
import {
  normalize,
  setTrackerData,
  syncFromDatabase,
  syncCFSolves,
  getTrackerState,
  useTracker,
  type TrackerData,
} from "@/lib/tracker-store";

const AUTH_KEY = "mission-lgm-admin";
const USER = "admin";
const PASS = "admin2026";

// Global cache for official Codeforces problem list during admin editing
let cfProblemsCache: Map<string, string> | null = null;

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Mission LGM Tracker" },
      { name: "description", content: "Private console for editing handles, dates and problems." },
      { property: "og:title", content: "Admin — Mission LGM Tracker" },
      { property: "og:description", content: "Private console for the Mission LGM tracker." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    setAuthed(sessionStorage.getItem(AUTH_KEY) === "1");
  }, []);

  return (
    <main className="min-h-screen px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {authed ? (
          <Editor
            onLogout={() => {
              sessionStorage.removeItem(AUTH_KEY);
              setAuthed(false);
            }}
          />
        ) : (
          <Login
            onSuccess={() => {
              sessionStorage.setItem(AUTH_KEY, "1");
              setAuthed(true);
            }}
          />
        )}
      </div>
    </main>
  );
}

const input =
  "w-full rounded-lg border border-[#8A5214]/60 bg-[#FFFDF9] px-3 py-2 text-sm font-bold text-[#211002] outline-none transition focus:border-[#D4932F] focus:ring-2 focus:ring-[#FFD700]/50 shadow-inner font-sans";

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (id === USER && pw === PASS) onSuccess();
        else setError(true);
      }}
      className="glass mx-auto mt-20 w-full max-w-sm space-y-5 rounded-2xl p-8 shadow-[0_8px_30px_rgba(130,95,35,0.18)] border border-[#AF8032]/45"
    >
      <div className="flex items-center gap-3 border-b border-[#AF8032]/30 pb-3">
        <Lock size={20} className="text-[#A3731E]" />
        <h1 className="font-display text-xl font-bold tracking-tight text-[#8C621C]">Admin Access</h1>
      </div>
      <div className="space-y-3.5">
        <input
          className={input}
          placeholder="ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
          autoComplete="username"
        />
        <input
          className={input}
          type="password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      {error && <p className="text-xs font-bold text-[#B81D35]">Wrong credentials provided.</p>}
      <button
        type="submit"
        className="w-full rounded-lg bg-gradient-to-r from-[#A3731E] to-[#7D5310] px-4 py-2.5 font-display text-sm font-bold tracking-wider uppercase text-white shadow-md transition hover:opacity-90 cursor-pointer"
      >
        Unlock Royal Vault
      </button>
    </form>
  );
}

function Editor({ onLogout }: { onLogout: () => void }) {
  const live = useTracker();
  const [draft, setDraft] = useState<TrackerData>(live);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [saved, setSaved] = useState(true);
  const [fetchingTitle, setFetchingTitle] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>("Synced with Supabase & LocalStorage");
  const [newHandle, setNewHandle] = useState("");
  const [newDate, setNewDate] = useState("");
  const [openDate, setOpenDate] = useState<string | null>(null);

  // Automatically sync draft state whenever updated data arrives from database or Codeforces
  useEffect(() => {
    setDraft(live);
  }, [live]);

  // Whenever ANYTHING is edited in Admin, immediately push to Supabase and sync with localStorage!
  const update = async (next: TrackerData) => {
    const normalized = normalize(next);
    setDraft(normalized);
    setSaving(true);
    setSaveStatus("Pushing live edits to Supabase Database & LocalStorage...");
    const ok = await setTrackerData(normalized);
    setSaving(false);
    setSaved(ok);
    setSaveStatus(ok ? "Realtime edits permanently saved to Supabase & LocalStorage!" : "Saved to LocalStorage (Check Supabase connection)");
  };

  const updateDays = (days: TrackerDay[]) => update({ ...draft, days });

  const patchDay = (date: string, patch: Partial<TrackerDay>) =>
    updateDays(draft.days.map((d) => (d.date === date ? { ...d, ...patch } : d)));

  const patchProblem = (date: string, idx: number, patch: Partial<Problem>) =>
    patchDay(date, {
      problems: draft.days
        .find((d) => d.date === date)!
        .problems.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    });

  const save = async () => {
    setSaving(true);
    setSaveStatus("Force syncing snapshot to Supabase Database...");
    const success = await setTrackerData(normalize(draft));
    setSaving(false);
    setSaved(true);
    setSaveStatus(success ? "Permanently synchronized with Supabase Database!" : "Saved locally (Note: verify table 'tracker_state' in Supabase)");
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setSaveStatus("Saving changes & syncing live Codeforces solve status...");
    
    // Step 1: Push current draft to database first so newly inscribed problems and dates are permanently saved!
    const normalized = normalize(draft);
    await setTrackerData(normalized);

    // Step 2: Trigger live Codeforces solve check across all handles for the new problems!
    const cfSuccess = await syncCFSolves();

    // Step 3: Safely retrieve updated state without calling React hooks inside async callbacks!
    setDraft(getTrackerState());
    setSyncing(false);

    if (cfSuccess) {
      setSaveStatus("Synchronized! Latest problems saved to Supabase & CF live solves updated.");
    } else {
      setSaveStatus("Changes saved to Supabase database! (Note: CF API rate limited or offline)");
    }
  };

  // Automated Codeforces Title Fetcher
  const autoFillFromCF = async (date: string, idx: number, urlOrId: string) => {
    const match = urlOrId.match(/(?:contest|problemset\/problem)\/(\d+)\/(?:problem\/)?([A-Za-z0-9]+)/) || urlOrId.match(/^(\d+)([A-Za-z0-9]+)$/);
    if (!match) {
      alert("Invalid Codeforces URL or ID format. Try something like https://codeforces.com/contest/1312/problem/E or 1312E");
      return;
    }
    const contestId = parseInt(match[1]);
    const index = match[2].toUpperCase();
    const id = `${contestId}${index}`;

    setFetchingTitle(`${date}_${idx}`);
    try {
      if (!cfProblemsCache) {
        const resp = await fetch("https://codeforces.com/api/problemset.problems");
        const json = await resp.json();
        if (json.status === "OK") {
          cfProblemsCache = new Map();
          for (const p of json.result.problems) {
            if (p.contestId && p.index) {
              cfProblemsCache.set(`${p.contestId}_${p.index}`, p.name);
            }
          }
        }
      }
      const officialTitle = cfProblemsCache?.get(`${contestId}_${index}`);
      if (officialTitle) {
        patchProblem(date, idx, { id, name: officialTitle, url: `https://codeforces.com/contest/${contestId}/problem/${index}` });
      } else {
        patchProblem(date, idx, { id, url: `https://codeforces.com/contest/${contestId}/problem/${index}` });
        alert(`Could not automatically match title for ${id} in Codeforces archive.`);
      }
    } catch (e) {
      alert("Failed to reach Codeforces API. Please check your network connection.");
    } finally {
      setFetchingTitle(null);
    }
  };

  const handleSubmissionIdChange = (date: string, idx: number, handle: string, subId: string, prob: Problem) => {
    const newIds = { ...(prob.submissionIds || {}), [handle]: subId };
    const newUrls = { ...(prob.submissionUrls || {}) };
    if (subId) {
      const contestMatch = prob.url.match(/contest\/(\d+)/) || prob.id.match(/^(\d+)/);
      const cid = contestMatch ? contestMatch[1] : "0";
      newUrls[handle] = `https://codeforces.com/contest/${cid}/submission/${subId}`;
    } else {
      delete newUrls[handle];
    }
    patchProblem(date, idx, { submissionIds: newIds, submissionUrls: newUrls });
  };

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#AF8032]/35 pb-6">
        <div>
          <p className="font-display text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#8C621C]">
            Mission LGM · Cloud Console
          </p>
          <h1 className="font-display text-3xl font-black tracking-tight text-[#2A1C12]">Royal Admin Vault</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleManualSync}
            disabled={syncing}
            className="glass flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-[#7D6346] transition hover:text-[#2A1C12] cursor-pointer border border-[#AF8032]/45"
            title="Refresh and pull latest data from Supabase Cloud Database"
          >
            <RefreshCw size={13} className={syncing ? "animate-spin" : ""} /> Sync Database
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="glass rounded-full px-4 py-2 text-xs font-bold text-[#7D6346] transition hover:text-[#2A1C12] cursor-pointer border border-[#AF8032]/45"
          >
            Lock &amp; Exit
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={`flex items-center gap-2 rounded-full px-5 py-2 font-display text-xs font-bold uppercase tracking-wider text-white shadow-md transition cursor-pointer ${
              saved ? "bg-gradient-to-r from-[#227D44] to-[#12582B]" : "bg-gradient-to-r from-[#A3731E] to-[#7A5312] hover:opacity-95"
            }`}
          >
            {saving ? (
              <>
                <Cloud size={14} className="animate-bounce" /> Syncing Cloud...
              </>
            ) : saved ? (
              <>
                <CheckCircle2 size={14} /> Database Synchronized
              </>
            ) : (
              <>
                <Save size={14} /> Save Permanent
              </>
            )}
          </button>
        </div>
      </header>

      {/* Sync Status Banner */}
      <div className="flex items-center justify-between rounded-xl bg-[#EDE3CF] border border-[#AF8032]/40 px-4 py-2.5 text-xs font-bold text-[#6B4E1A] shadow-sm">
        <span className="flex items-center gap-2">
          <Cloud size={15} className="text-[#A3731E]" />
          <span>Database State: <strong className="text-[#2A1C12]">{saveStatus}</strong></span>
        </span>
        <span className="text-[11px] font-normal text-[#7D6346]">Table: <code>tracker_state</code></span>
      </div>

      {/* Handles */}
      <section className="glass rounded-2xl p-6 border border-[#AF8032]/45">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[#8C621C]">Champion Handles (Columns)</h2>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {draft.handles.map((h, i) => (
            <span
              key={`${h}-${i}`}
              className="flex items-center gap-2 rounded-lg bg-[#F7ECD8] border border-[#AF8032]/40 px-3 py-1.5 text-xs font-bold text-[#2A1C12] shadow-sm"
            >
              <input
                className="w-28 bg-transparent outline-none font-display text-sm font-black"
                value={h}
                onChange={(e) =>
                  update({
                    ...draft,
                    handles: draft.handles.map((x, xi) => (xi === i ? e.target.value : x)),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove ${h}`}
                onClick={() =>
                  update({ ...draft, handles: draft.handles.filter((_, xi) => xi !== i) })
                }
                className="text-[#B81D35] hover:scale-110 transition-transform"
              >
                <X size={15} className="stroke-[2.5]" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-5 flex gap-3 max-w-xs">
          <input
            className={input}
            placeholder="New Handle (e.g., SUST_Alpha)"
            value={newHandle}
            onChange={(e) => setNewHandle(e.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              const h = newHandle.trim();
              if (!h || draft.handles.includes(h)) return;
              update({ ...draft, handles: [...draft.handles, h] });
              setNewHandle("");
            }}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-[#A3731E] px-3.5 text-xs font-bold uppercase text-white shadow transition hover:opacity-90 cursor-pointer font-display"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </section>

      {/* New date */}
      <section className="glass rounded-2xl p-6 border border-[#AF8032]/45">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[#8C621C]">Inscribe a New Chronicle Date</h2>
        <div className="mt-4 flex gap-3 max-w-xs">
          <input
            type="date"
            className={input}
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              if (!newDate || draft.days.some((d) => d.date === newDate)) return;
              updateDays(
                [...draft.days, { date: newDate, problems: [] }].sort((a, b) =>
                  a.date < b.date ? 1 : -1,
                ),
              );
              setOpenDate(newDate);
              setNewDate("");
            }}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-[#A3731E] px-4 text-xs font-bold uppercase text-white shadow transition hover:opacity-90 cursor-pointer font-display"
          >
            <Plus size={14} /> Create
          </button>
        </div>
      </section>

      {/* Dates */}
      <section className="space-y-4">
        {draft.days.map((day) => {
          const open = openDate === day.date;
          return (
            <div key={day.date} className="glass rounded-2xl p-5 border border-[#AF8032]/45">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setOpenDate(open ? null : day.date)}
                  className="flex items-baseline gap-4 text-left cursor-pointer"
                >
                  <span className="font-display text-base font-black text-[#2A1C12] hover:text-[#A3731E] transition-colors">{day.date}</span>
                  <span className="rounded bg-[#EEDEB5] border border-[#AF8032]/40 px-2 py-0.5 text-xs font-bold text-[#735114]">
                    {day.problems.length} quests logged
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${day.date}`}
                  onClick={() => {
                    if (confirm(`Permanently delete chronicle on ${day.date}?`))
                      updateDays(draft.days.filter((d) => d.date !== day.date));
                  }}
                  className="text-[#B81D35] hover:scale-110 transition-transform p-1 cursor-pointer"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {open && (
                <div className="mt-5 space-y-4 pt-4 border-t border-[#AF8032]/30">
                  {day.problems.map((p, i) => (
                    <div key={i} className="rounded-xl border border-[#AF8032]/40 bg-[#FFFDF8]/90 p-4 shadow-sm">
                      <div className="grid gap-3 sm:grid-cols-12 items-center">
                        <div className="sm:col-span-3">
                          <input
                            className={input}
                            placeholder="ID (e.g. 1312E)"
                            value={p.id}
                            onChange={(e) => patchProblem(day.date, i, { id: e.target.value })}
                          />
                        </div>
                        <div className="sm:col-span-4">
                          <input
                            className={input}
                            placeholder="Problem Title / Quest Name"
                            value={p.name}
                            onChange={(e) => patchProblem(day.date, i, { name: e.target.value })}
                          />
                        </div>
                        <div className="sm:col-span-5 flex items-center gap-2">
                          <input
                            className={input}
                            placeholder="https://codeforces.com/..."
                            value={p.url}
                            onChange={(e) => patchProblem(day.date, i, { url: e.target.value })}
                          />
                          <button
                            type="button"
                            title="Auto-fetch Official Problem Title from Codeforces API"
                            onClick={() => autoFillFromCF(day.date, i, p.url || p.id)}
                            disabled={fetchingTitle === `${day.date}_${i}` || (!p.url && !p.id)}
                            className="flex items-center gap-1 shrink-0 rounded bg-[#EEDEB5] border border-[#A3731E]/60 px-2.5 py-2 font-display text-xs font-bold text-[#735114] hover:bg-[#DEC28A] disabled:opacity-50 transition cursor-pointer shadow-sm"
                          >
                            <Wand2 size={13} className={fetchingTitle === `${day.date}_${i}` ? "animate-spin text-[#A3731E]" : "text-[#A3731E]"} />
                            <span>{fetchingTitle === `${day.date}_${i}` ? "Fetching..." : "Fetch Title"}</span>
                          </button>
                        </div>
                      </div>

                      {/* Conquests & Editable Submission IDs */}
                      <div className="mt-4 flex flex-col gap-3 bg-[#F7F0E4] p-3 rounded-lg border border-[#AF8032]/25">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#AF8032]/20 pb-2">
                          <span className="text-xs font-display font-bold uppercase tracking-wider text-[#7D6346]">
                            Champion Conquests &amp; Editable Submission IDs
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              patchDay(day.date, {
                                problems: day.problems.filter((_, xi) => xi !== i),
                              })
                            }
                            className="flex items-center gap-1 rounded bg-[#FCECEE] border border-[#BA3A4B]/40 px-2.5 py-1 text-xs font-bold text-[#B81D35] hover:bg-[#B81D35] hover:text-white transition-colors cursor-pointer"
                          >
                            <Trash2 size={13} /> Delete Quest
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                          {draft.handles.map((h) => {
                            const isSolved = Boolean(p.solvedBy[h]);
                            const subId = p.submissionIds?.[h] || "";
                            return (
                              <div key={h} className="flex items-center justify-between gap-2 rounded bg-[#FFFDF8] border border-[#AF8032]/30 p-2 shadow-inner">
                                <label className="flex items-center gap-2 text-xs font-bold text-[#2A1C12] cursor-pointer hover:text-[#A3731E]">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-[#AF8032]/60 accent-[#A3731E]"
                                    checked={isSolved}
                                    onChange={(e) =>
                                      patchProblem(day.date, i, {
                                        solvedBy: { ...p.solvedBy, [h]: e.target.checked },
                                      })
                                    }
                                  />
                                  <span>{h}</span>
                                </label>

                                {isSolved && (
                                  <div className="flex items-center gap-1 bg-[#EAE0CB]/60 px-2 py-0.5 rounded border border-[#AF8032]/35">
                                    <Hash size={12} className="text-[#8C621C]" />
                                    <input
                                      className="w-20 bg-transparent text-xs font-bold tabular-nums text-[#694A14] outline-none placeholder:text-[#A68A5C]/70"
                                      placeholder="Sub ID..."
                                      value={subId}
                                      onChange={(e) => handleSubmissionIdChange(day.date, i, h, e.target.value, p)}
                                      title={`Edit Submission ID for ${h}`}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      patchDay(day.date, {
                        problems: [
                          ...day.problems,
                          { id: "", name: "", url: "", solvedBy: {}, submissionIds: {}, submissionUrls: {} } as Problem,
                        ],
                      })
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-[#EAE0CB] border border-[#AF8032]/45 px-4 py-2 font-display text-xs font-bold uppercase text-[#735114] shadow hover:bg-[#DEC28A] transition cursor-pointer"
                  >
                    <Plus size={14} /> Add Problem to this Date
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
