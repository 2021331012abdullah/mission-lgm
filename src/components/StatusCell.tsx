import { ShieldCheck, ShieldAlert, ExternalLink } from "lucide-react";

export function StatusCell({
  solved,
  submissionUrl,
  submissionId,
}: {
  solved: boolean;
  submissionUrl?: string;
  submissionId?: string;
}) {
  const content = solved ? (
    <>
      <ShieldCheck
        size={19}
        className="stroke-[2.3] glowing-tick text-[#FFDF73] drop-shadow-[0_0_10px_rgba(255,223,115,0.95)] transition-transform duration-300 group-hover/btn:scale-110"
      />
      {submissionUrl && (
        <ExternalLink
          size={11}
          className="absolute bottom-1 right-1 text-[#FFDF73] opacity-0 group-hover/btn:opacity-100 transition-opacity drop-shadow-[0_0_5px_#FFDF73]"
        />
      )}
    </>
  ) : (
    <ShieldAlert size={17} className="stroke-[1.8] opacity-70 text-[#C97878]" />
  );

  const badgeClass = solved
    ? "group/btn relative inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-[#694C21] via-[#4D3616] to-[#2B1D0B] text-[#FFDF73] ring-1 ring-[#FFDF73]/85 shadow-[0_0_18px_rgba(255,215,0,0.55),_0_2px_8px_rgba(0,0,0,0.7)] transition-all duration-300 hover:scale-115 hover:ring-2 hover:ring-[#FFF3A8] hover:shadow-[0_0_28px_rgba(255,223,115,0.95)] cursor-pointer"
    : "inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-b from-[#3B3028] to-[#261E1A] text-[#C97878] ring-1 ring-[#A36262]/40 transition-colors group-hover/row:text-[#E08D8D] group-hover/row:bg-[#483B32]";

  const tooltip = solved
    ? submissionId
      ? `Conquered Trial (Submission #${submissionId}) — Click to inspect winning Codeforces submission`
      : "Conquered Trial — Click to view submission"
    : "Unvanquished Challenge";

  return (
    <td className="border-l border-[#D4AF37]/30 px-3 py-2.5 text-center align-middle">
      {solved && submissionUrl ? (
        <a
          href={submissionUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View last successful submission on Codeforces"
          title={tooltip}
          className={badgeClass}
        >
          {content}
        </a>
      ) : (
        <span
          aria-label={solved ? "Conquered Trial" : "Unvanquished Challenge"}
          title={tooltip}
          className={badgeClass}
        >
          {content}
        </span>
      )}
    </td>
  );
}
