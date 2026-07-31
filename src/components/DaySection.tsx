import { useState, useRef, useMemo } from "react";
import { Crown, Shield, Swords, BookOpen, Target, Share2, Copy, Download, Check, Image as ImageIcon, Loader2 } from "lucide-react";
import type { TrackerDay, Handle } from "@/data/tracker";
import { waitForInitialSyncs } from "@/lib/tracker-store";
import { getWarfareLine } from "@/data/warfare-lines";
import { SolveTable } from "./SolveTable";
import { toBlob, toPng } from "html-to-image";

const MEDALS = [
  { 
    bg: "bg-gradient-to-b from-[#6B5126] via-[#543E1B] to-[#3B2910]", 
    border: "border-[#FFDF73]/85", 
    text: "text-[#FFD700]", 
    label: "Lord Vanguard",
    icon: <Crown size={15} className="text-[#FFDF73] shrink-0 drop-shadow-[0_0_8px_#FFD700]" /> 
  },
  { 
    bg: "bg-gradient-to-b from-[#48505E] via-[#373F4B] to-[#272D36]", 
    border: "border-[#DFE6F2]/80", 
    text: "text-[#F2F6FE]", 
    label: "Grand Knight",
    icon: <Shield size={14} className="text-[#DFE6F2] shrink-0 drop-shadow-[0_0_5px_rgba(223,230,242,0.6)]" /> 
  },
  { 
    bg: "bg-gradient-to-b from-[#614023] via-[#4A2F18] to-[#341F0E]", 
    border: "border-[#EAB585]/80", 
    text: "text-[#FCDCBF]", 
    label: "Valiant Squire",
    icon: <Swords size={14} className="text-[#EAB585] shrink-0" /> 
  },
];

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function DaySection({
  day,
  handles,
  onShare,
  isModal = false,
}: {
  day: TrackerDay;
  handles: Handle[];
  onShare?: (date: string) => void;
  isModal?: boolean;
}) {
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [copyingImg, setCopyingImg] = useState(false);
  const [downloadingImg, setDownloadingImg] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  // Retrieve a unique motivational warfare sentence for this chronicle
  const warfareMotto = useMemo(() => getWarfareLine(day.date), [day.date]);

  const fullySolved = day.problems.filter((p) => handles.every((h) => p.solvedBy[h])).length;
  const totalCells = day.problems.length * handles.length;
  const solvedCells = day.problems.reduce(
    (n, p) => n + handles.filter((h) => p.solvedBy[h]).length,
    0,
  );
  const rate = totalCells ? Math.round((solvedCells / totalCells) * 100) : 0;

  const podium = handles
    .map((h) => ({ handle: h, solved: day.problems.filter((p) => p.solvedBy[h]).length }))
    .sort((a, b) => b.solved - a.solved || a.handle.localeCompare(b.handle))
    .slice(0, 3);

  // Filter to exclude interactive web UI buttons from generated social media photos
  const excludeButtonsFilter = (node: any) => {
    if (node && typeof node.hasAttribute === "function" && node.hasAttribute("data-exclude-from-capture")) {
      return false;
    }
    return true;
  };

  // Copy table screenshot image directly to clipboard for Ctrl+V pasting into WhatsApp / Telegram / Facebook Web
  const handleCopyImage = async () => {
    if (!tableContainerRef.current) return;
    setCopyingImg(true);
    try {
      await waitForInitialSyncs();
      // CHROME/CHROMIUM WARMUP RENDER: Force Chrome to load custom fonts and settle flex alignment before final image extraction!
      try { await toPng(tableContainerRef.current, { cacheBust: true, pixelRatio: 1, backgroundColor: "#140E0A", filter: excludeButtonsFilter }); } catch {}
      const blob = await toBlob(tableContainerRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: "#140E0A", filter: excludeButtonsFilter });
      if (blob && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopiedSuccess(true);
        setTimeout(() => setCopiedSuccess(false), 3000);
      }
    } catch (err) {
      console.error("Failed to copy table image:", err);
    } finally {
      setCopyingImg(false);
    }
  };

  // Download high-res PNG of the table for immediate social media attachment
  const handleDownloadImage = async () => {
    if (!tableContainerRef.current) return;
    setDownloadingImg(true);
    try {
      await waitForInitialSyncs();
      // CHROME/CHROMIUM WARMUP RENDER: Force Chrome to settle font sizing and layout metrics before saving PNG!
      try { await toPng(tableContainerRef.current, { cacheBust: true, pixelRatio: 1, backgroundColor: "#140E0A", filter: excludeButtonsFilter }); } catch {}
      const dataUrl = await toPng(tableContainerRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: "#140E0A", filter: excludeButtonsFilter });
      const link = document.createElement("a");
      link.download = `Mission_LGM_Chronicle_${day.date}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error("Failed to download table image:", err);
    } finally {
      setDownloadingImg(false);
    }
  };

  return (
    <div
      ref={tableContainerRef}
      id={`chronicle-table-${day.date}`}
      className={`royal-table-frame ${isModal ? "shadow-[0_0_45px_rgba(255,215,0,0.35)]" : ""}`}
    >
      <div className="royal-table-inner">
        <div className="royal-table-header px-7 py-5 space-y-4">
          {/* TOP TITLE ROW: Contains icon, Motivational Warfare Sentence, Date Title & SHARE / ACTION buttons right on the same row! */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3.5 flex-1 min-w-[280px]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-[#634822] to-[#362510] border border-[#D4AF37]/80 shadow-[0_3px_10px_rgba(0,0,0,0.8),_0_0_15px_rgba(255,215,0,0.35)]">
                <BookOpen size={20} className="text-[#FFDF73] drop-shadow-[0_0_8px_rgba(255,215,0,0.85)]" />
              </span>
              <div className="flex-1">
                <span className="block font-display text-[12px] font-bold tracking-[0.08em] text-[#FFE79E] drop-shadow-[0_1px_2px_rgba(0,0,0,1)] leading-tight italic">
                  &ldquo;{warfareMotto}&rdquo;
                </span>
                <h2 className="font-display text-2xl font-extrabold tracking-wide text-[#FFFBF3] drop-shadow-[0_2px_4px_rgba(0,0,0,1)] mt-1">
                  {formatDate(day.date)}
                </h2>
              </div>
            </div>

            {/* Share / Photo buttons located cleanly on the same top row! (Excluded when taking photo) */}
            <div data-exclude-from-capture="true" className="flex items-center gap-2.5 shrink-0 self-center">
              {!isModal && onShare && (
                <button
                  type="button"
                  onClick={() => onShare(day.date)}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#7A5826] via-[#573C17] to-[#2E1E0B] border-2 border-[#FFDF73]/90 px-4 py-2 font-display text-xs font-black uppercase tracking-wider text-[#FFDF73] shadow-[0_4px_12px_rgba(0,0,0,0.9),_0_0_18px_rgba(255,215,0,0.4)] transition-all duration-300 hover:scale-108 hover:border-[#FFF5B0] hover:shadow-[0_0_28px_rgba(255,220,100,0.8)] cursor-pointer"
                  title="Share this chronicle table (copies link & enters focus mode)"
                  aria-label="Share Table"
                >
                  <Share2 size={16} className="text-[#FFDF73] shrink-0 drop-shadow-[0_0_6px_rgba(255,215,0,0.9)] animate-pulse" />
                  <span>Share</span>
                </button>
              )}

              {isModal && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyImage}
                    disabled={copyingImg}
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#523B18] via-[#3B2910] to-[#211608] border border-[#FFDF73]/80 px-3.5 py-2 font-display text-xs font-black uppercase text-[#FFDF73] hover:brightness-125 transition shadow-md disabled:opacity-50 cursor-pointer"
                    title="Copy table picture to clipboard to paste directly into WhatsApp / Facebook / Telegram chat"
                  >
                    {copyingImg ? <Loader2 size={14} className="animate-spin" /> : copiedSuccess ? <Check size={14} className="text-[#22D3EE]" /> : <ImageIcon size={14} />}
                    <span>{copiedSuccess ? "Copied Photo!" : "Copy Photo"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadImage}
                    disabled={downloadingImg}
                    className="flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#523B18] via-[#3B2910] to-[#211608] border border-[#FFDF73]/80 px-3.5 py-2 font-display text-xs font-black uppercase text-[#FFDF73] hover:brightness-125 transition shadow-md disabled:opacity-50 cursor-pointer"
                    title="Download table PNG image file for social media upload"
                  >
                    {downloadingImg ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    <span>Save PNG</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* SECONDARY ROW: Medals, solve counts and valor percentage badge */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#D4AF37]/30 text-xs text-[#DEC8A2]">
            <div className="flex flex-wrap items-center gap-2">
              {podium.map((p, i) => (
                <span
                  key={p.handle}
                  className={`flex items-center gap-2 rounded-lg ${MEDALS[i].bg} border ${MEDALS[i].border} px-3 py-1.5 shadow-[0_3px_8px_rgba(0,0,0,0.7)]`}
                  title={`${MEDALS[i].label} — ${p.solved} conquered trials`}
                >
                  {MEDALS[i].icon}
                  <span className="font-display text-xs font-extrabold text-[#FFFDF8] tracking-wide drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]">
                    {p.handle}
                  </span>
                  <span className={`flex items-center gap-1 font-display text-xs font-black tabular-nums ${MEDALS[i].text}`}>
                    <span className="text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">{p.solved}</span>
                    <span className="text-sm leading-none" title="Conquered Quests">🏹</span>
                  </span>
                </span>
              ))}
            </div>
            
            <div className="flex items-center gap-4 ml-auto">
              <span className="font-sans text-sm font-bold text-[#F5EAD7] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                <span className="font-display font-black text-[#FFDF73] text-base">{fullySolved}</span>
                {" "}of {day.problems.length} unified triumphs
              </span>

              <span className="rounded-lg bg-gradient-to-b from-[#735427] to-[#402C12] border border-[#FFDF73]/90 px-3.5 py-1.5 font-display text-sm font-black tabular-nums text-[#FFDF73] shadow-[0_0_20px_rgba(255,215,0,0.5)]">
                {rate}% Valor
              </span>
            </div>
          </div>
        </div>

        <SolveTable problems={day.problems} handles={handles} />
      </div>
    </div>
  );
}
