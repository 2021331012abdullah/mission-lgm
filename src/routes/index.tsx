import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Shield, ChevronDown, Crown, Swords, Feather, ScrollText, Sparkles, RefreshCw, CheckCircle2, Cloud, X, Copy, Check, Share2 } from "lucide-react";
import { useTracker, useCFSyncStatus, syncCFSolves, waitForInitialSyncs } from "@/lib/tracker-store";
import { DaySection } from "@/components/DaySection";
import { Leaderboard, type LeaderRow } from "@/components/Leaderboard";
import { StatTile, Tile } from "@/components/Tile";
import { toBlob, toPng } from "html-to-image";

const PAGE = 7;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mission LGM — Overclocked Guerilla Training of the Realm" },
      {
        name: "description",
        content:
          "The grand chronicles of Codeforces trials and conquests, logged day by day for valiant champions.",
      },
      { property: "og:title", content: "Mission LGM — Overclocked Guerilla Training of the Realm" },
      {
        property: "og:description",
        content: "A daily archive of knightly Codeforces conquests per champion handle.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Index,
});

function Index() {
  const [visible, setVisible] = useState(PAGE);

  // SYNCHRONOUS INITIALIZATION: Ensures zero latency when visiting a table link (table modal pops up immediately on initial frame!)
  const [selectedTableDate, setSelectedTableDate] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const tableParam = params.get("table") || params.get("day");
    const hashParam = window.location.hash.replace(/^#(?:table-)?/, "");
    const targetDate = tableParam || hashParam;

    if (targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return targetDate;
    }
    return null;
  });

  const { days, handles } = useTracker();
  const cfSyncing = useCFSyncStatus();

  // Escape key listener to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedTableDate) {
        closeModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedTableDate]);

  // Dynamically update document title and social media meta tags when focus table is open
  useEffect(() => {
    if (selectedTableDate) {
      document.title = `Mission LGM Chronicle — ${selectedTableDate}`;
    } else {
      document.title = "Mission LGM — Overclocked Guerilla Training of the Realm";
    }
  }, [selectedTableDate]);

  const totalProblems = days.reduce((n, d) => n + d.problems.length, 0);

  const rows: LeaderRow[] = handles
    .map((h) => ({
      handle: h,
      solved: days.reduce((n, d) => n + d.problems.filter((p) => p.solvedBy[h]).length, 0),
      total: totalProblems,
    }))
    .sort((a, b) => b.solved - a.solved);

  const solvedCells = rows.reduce((n, r) => n + r.solved, 0);
  const slots = totalProblems * handles.length;
  const coverage = slots ? Math.round((solvedCells / slots) * 100) : 0;

  const cleanSweeps = days.reduce(
    (n, d) => n + d.problems.filter((p) => handles.every((h) => p.solvedBy[h])).length,
    0,
  );

  const visibleDays = days.slice(0, visible);
  const modalDay = days.find((d) => d.date === selectedTableDate);

  // Triggered when user clicks Share icon directly on a table
  const handleShareTable = async (date: string) => {
    setSelectedTableDate(date);

    // Update browser address bar without reload
    const url = new URL(window.location.href);
    url.searchParams.set("table", date);
    url.hash = "";
    window.history.pushState({}, "", url.toString());

    const shareUrl = url.toString();

    // Await database & CF synchronization so the photo incorporates the newest live solves!
    await waitForInitialSyncs();

    // Try capturing table image blob to attach directly into WhatsApp / Telegram / Facebook native share dialog!
    let imageFile: File | null = null;
    const el = document.getElementById(`chronicle-table-${date}`);
    if (el) {
      try {
        const blob = await toBlob(el, {
          cacheBust: true,
          pixelRatio: 2,
          backgroundColor: "#140E0A",
          filter: (node: any) => !(node && typeof node.hasAttribute === "function" && node.hasAttribute("data-exclude-from-capture")),
        });
        if (blob) {
          imageFile = new File([blob], `Mission_LGM_Table_${date}.png`, { type: "image/png" });
        }
      } catch (err) {
        console.warn("Could not render image for native share, falling back to link sharing:", err);
      }
    }
    // Launch OS native share popup if supported, passing the actual table image photo if allowed!
    if (navigator.share) {
      try {
        const sharePayload: ShareData = {
          title: `Mission LGM Chronicle — ${date}`,
          text: `Inspect the knightly Codeforces conquests and trials for ${date}!`,
          url: shareUrl,
        };

        // Attach exact table photo to WhatsApp / Facebook / Telegram if browser allows
        if (imageFile && navigator.canShare && navigator.canShare({ files: [imageFile] })) {
          sharePayload.files = [imageFile];
        }

        await navigator.share(sharePayload);
      } catch (err) {
        // User canceled OS share dialog or dismissed it
      }
    }
  };

  const closeModal = () => {
    setSelectedTableDate(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("table");
    url.searchParams.delete("day");
    url.hash = "";
    window.history.pushState({}, "", url.pathname + (url.search ? url.search : ""));
  };

  return (
    <main className="min-h-screen px-4 py-12 sm:px-8 relative">

      {/* Full-Screen Centered Table Modal with Blurred Backdrop (Pops up IMMEDIATELY with zero latency!) */}
      {modalDay && (
        <div
          onClick={closeModal}
          className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6 bg-black/70 backdrop-blur-md animate-in fade-in duration-150 overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-5xl my-auto animate-in zoom-in-95 duration-150"
          >
            <button
              type="button"
              onClick={closeModal}
              className="absolute -top-5 -right-3 sm:-top-6 sm:-right-6 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-b from-[#B81D35] via-[#94152A] to-[#690919] text-white border-2 border-[#FFA1B0] shadow-[0_4px_18px_rgba(184,29,53,0.7)] transition-transform hover:scale-115 cursor-pointer"
              aria-label="Close modal view"
              title="Exit focus mode and return to full realm"
            >
              <X size={22} className="stroke-[2.5]" />
            </button>

            <div className="max-h-[90vh] overflow-y-auto rounded-2xl border border-[#D4AF37]/60 shadow-[0_25px_70px_rgba(0,0,0,1)]">
              <DaySection day={modalDay} handles={handles} isModal />
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl space-y-9">
        {/* Live Codeforces & Database Synchronization Banner */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-[#EDE3CF] border border-[#AF8032]/45 px-5 py-3 text-xs font-bold text-[#6B4E1A] shadow-sm">
          <div className="flex items-center gap-2.5">
            {cfSyncing ? (
              <>
                <RefreshCw size={16} className="animate-spin text-[#A3731E]" />
                <span className="text-[#2A1C12] font-extrabold tracking-wide">
                  Querying Codeforces API &amp; Injecting Live Solves &amp; Submission Links into Database...
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 size={17} className="text-[#227D44]" />
                <span className="text-[#2A1C12] font-extrabold tracking-wide">
                  Live Solves Synchronized with Codeforces API &amp; Permanent Cloud Database
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => syncCFSolves()}
            disabled={cfSyncing}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#A3731E] to-[#7D520F] px-3.5 py-1.5 font-display text-xs font-bold uppercase text-white shadow hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
            title="Force fetch newest submissions from Codeforces API and save to database"
          >
            <Cloud size={13} className={cfSyncing ? "animate-bounce" : ""} />
            <span>{cfSyncing ? "Updating..." : "Refresh Live Solves"}</span>
          </button>
        </div>

        {/* Royal Title & Inscription Header */}
        <header className="flex flex-wrap items-end justify-between gap-6 border-b-2 border-[#AF8032]/35 pb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <Feather className="text-[#966C1A] shrink-0 drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]" size={18} />
              <p className="font-display text-[13px] font-extrabold uppercase tracking-[0.25em] text-[#8C621C] drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
                Overclocked Guerilla Training
              </p>
            </div>

            <h1 className="font-display text-5xl sm:text-6xl font-black tracking-wide drop-shadow-[0_2px_4px_rgba(120,85,30,0.18)] py-1">
              <span className="gold-gradient-text mr-4">Mission</span>
              <span className="ruby-gradient-text">LGM</span>
            </h1>
          </div>

          <div className="flex items-center gap-2.5 glass rounded-full px-5 py-2.5 text-xs font-display font-bold text-[#3D2B1F] border border-[#AF8032]/45 shadow-[0_3px_15px_rgba(150,110,30,0.15)]">
            <Shield size={16} className="text-[#A3731E] fill-[#A3731E]/20 drop-shadow-[0_1px_2px_rgba(160,115,30,0.25)]" />
            <span className="tracking-wider text-[13px] font-extrabold text-[#694A14]">{handles.length} Valiant Champions Tracked</span>
          </div>
        </header>

        {/* Heraldic Stat Tiles */}
        <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-4">
          <StatTile label="Chronicle Annals" value={days.length} hint="Practice sessions inscribed" />
          <StatTile label="Trials of Valor" value={totalProblems} hint="Battles waged across the realm" />
          <StatTile label="Domain Mastery" value={coverage} suffix="%" hint="Conquest over all challenges" />
          <StatTile label="Flawless Triumphs" value={cleanSweeps} hint="Quests subdued by all knights" />
        </section>

        {/* Order of Champions & Campaign Fervor */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <Leaderboard rows={rows} />
          </div>

          <div className="grid gap-6 lg:col-span-2">
            <Tile className="p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#AF8032]/30 pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={17} className="text-[#A3731E]" />
                  <h2 className="font-display text-base font-bold uppercase tracking-wider text-[#8C621C] drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
                    Campaign Fervor &amp; Momentum
                  </h2>
                </div>
                <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-[#7D6346]">
                  Valor Rate · Last 7 Chronicles
                </span>
              </div>

              <div className="mt-6 flex items-end gap-3 px-2">
                {[...days]
                  .slice(0, 7)
                  .reverse()
                  .map((d) => {
                    const cells = d.problems.length * handles.length;
                    const got = d.problems.reduce(
                      (n, p) => n + handles.filter((h) => p.solvedBy[h]).length,
                      0,
                    );
                    const pct = cells ? Math.round((got / cells) * 100) : 0;

                    const heatClass =
                      pct >= 67
                        ? "bg-gradient-to-t from-[#A62B3D] via-[#CC3D52] to-[#E85C72] border-t-2 border-[#B82B3E] shadow-[0_2px_10px_rgba(180,40,60,0.25)]"
                        : pct >= 34
                          ? "bg-gradient-to-t from-[#A67523] via-[#C9963A] to-[#E3B65D] border-t-2 border-[#BA892B] shadow-[0_2px_8px_rgba(175,125,35,0.25)]"
                          : "bg-gradient-to-t from-[#8C7450] via-[#A68F6A] to-[#BFB091] border-t border-[#A68A60]/60";

                    return (
                      <div key={d.date} className="group flex flex-1 flex-col items-center gap-2.5">
                        <span className="font-display text-xs font-black tabular-nums text-[#735114] drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">
                          {pct}%
                        </span>
                        <div className="flex h-36 w-full items-end overflow-hidden rounded-lg bg-[#EFE6D5] border border-[#AF8032]/35 shadow-inner p-1">
                          <div
                            className={`w-full rounded-md transition-all duration-700 ${heatClass}`}
                            style={{ height: `${pct}%` }}
                          />
                        </div>
                        <span className="font-display text-xs font-extrabold text-[#6B5238]">
                          {d.date.slice(5)}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </Tile>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Tile className="flex items-center gap-5 p-6">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-[#FAF0DA] to-[#F2DFB3] border border-[#B88A35]/65 shadow-[0_2px_12px_rgba(165,120,30,0.2)]">
                  <Crown size={26} className="text-[#A87B20] fill-[#A87B20]/25 animate-pulse drop-shadow-[0_1px_2px_rgba(150,110,30,0.3)]" />
                </span>
                <div>
                  <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-[#8C621C]">
                    Supreme Lord Vanguard
                  </p>
                  <p className="mt-0.5 font-display text-xl font-black text-[#2A1C12] tracking-wide drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
                    {rows[0]?.handle ?? "—"}
                  </p>
                  <p className="font-sans text-sm font-semibold italic text-[#7D6346]">
                    Reigns with {rows[0]?.solved ?? 0} total conquests
                  </p>
                </div>
              </Tile>

              <Tile className="flex items-center gap-5 p-6">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-[#FAECED] to-[#F2D1D6] border border-[#BA3A4B]/60 shadow-[0_2px_12px_rgba(180,45,65,0.2)]">
                  <Swords size={24} className="text-[#B81D35] drop-shadow-[0_1px_2px_rgba(180,35,55,0.35)]" />
                </span>
                <div>
                  <p className="font-display text-xs font-bold uppercase tracking-[0.18em] text-[#B81D35]">
                    Open Defiances
                  </p>
                  <p className="mt-0.5 font-display text-xl font-black text-[#2A1C12] tabular-nums tracking-wide drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
                    {totalProblems * handles.length - solvedCells} Trials
                  </p>
                  <p className="font-sans text-sm font-semibold italic text-[#7D6346]">
                    Awaiting triumphant upsolve in the arena
                  </p>
                </div>
              </Tile>
            </div>
          </div>
        </section>

        {/* Daily Chronicles with Ornate Tudor Separators */}
        <section className="space-y-8 pt-4">
          <div className="flex items-center gap-4 py-2">
            <div className="h-[2px] flex-1 bg-gradient-to-r from-transparent via-[#B88A35]/40 to-[#B88A35]/60" />
            <span className="font-display text-sm font-extrabold uppercase tracking-[0.3em] text-[#8C621C] drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">
              ❖ Annals of the Training Grounds ❖
            </span>
            <div className="h-[2px] flex-1 bg-gradient-to-l from-transparent via-[#B88A35]/40 to-[#B88A35]/60" />
          </div>

          <div className="space-y-12">
            {visibleDays.map((day, idx) => (
              <div key={day.date} className="space-y-11">
                <DaySection day={day} handles={handles} onShare={handleShareTable} />

                {/* Ornate Tudor / Renaissance Heraldic Separator between tables */}
                {idx < visibleDays.length - 1 && (
                  <div className="flex items-center justify-center py-2 opacity-85">
                    <div className="h-[2px] flex-1 max-w-xs bg-gradient-to-r from-transparent via-[#AF8032]/40 to-[#AF8032]/80" />
                    <div className="mx-6 flex items-center gap-3.5 text-[#9E7124] drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)]">
                      <span className="text-sm font-display text-[#B88A35]">✦</span>
                      <span className="text-lg font-display font-black tracking-[0.2em]">❖ ⚜ ❖</span>
                      <span className="text-sm font-display text-[#B88A35]">✦</span>
                    </div>
                    <div className="h-[2px] flex-1 max-w-xs bg-gradient-to-l from-transparent via-[#AF8032]/40 to-[#AF8032]/80" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Unfurl More Chronicles */}
        {visible < days.length && (
          <div className="flex flex-col items-center gap-3 pt-6">
            <button
              type="button"
              onClick={() => setVisible((v) => Math.min(v + PAGE, days.length))}
              aria-label="Load 7 more chronicles"
              className="glass group flex px-7 py-3.5 items-center justify-center gap-3 rounded-full text-[#6E4E14] border border-[#AF8032]/55 shadow-[0_4px_22px_rgba(165,120,30,0.2)] transition-all duration-300 hover:-translate-y-1 hover:border-[#A3731E] hover:shadow-[0_8px_32px_rgba(165,120,30,0.35)] cursor-pointer font-display text-xs font-black uppercase tracking-[0.25em]"
            >
              <ScrollText size={18} className="text-[#A3731E] group-hover:scale-110 transition-transform" />
              <span>Unfurl 7 More Chronicles of the Realm</span>
              <ChevronDown size={18} className="group-hover:translate-y-0.5 transition-transform text-[#A3731E]" />
            </button>
            <span className="font-sans text-xs font-semibold italic text-[#7D6346]">
              {days.length - visible} chapters yet remain sealed in the vault
            </span>
          </div>
        )}

        {/* Classical Colophon Footer */}
        <footer className="border-t-2 border-[#AF8032]/40 pt-8 pb-4 text-center font-sans text-base font-bold italic text-[#7D6346] drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
          ❖ — Forging SUST into Legendary Grandmasters — Chasing ICPC World Finals 2029 Gold Medal! — ❖
        </footer>
      </div>
    </main>
  );
}
