import type { Problem, Handle } from "@/data/tracker";
import { StatusCell } from "./StatusCell";
import { Scroll, ExternalLink } from "lucide-react";

export function SolveTable({
  problems,
  handles,
}: {
  problems: Problem[];
  handles: Handle[];
}) {
  const countFor = (h: Handle) => problems.filter((p) => p.solvedBy[h]).length;

  return (
    <div className="overflow-x-auto bg-[#2C2114]">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-[#D4AF37]/65 scratchy-table-th shadow-lg">
            <th className="sticky left-0 z-10 scratchy-table-th min-w-[260px] px-7 py-4 text-left font-display text-[12px] font-extrabold uppercase tracking-[0.22em] text-[#F3E0B5] drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] border-r border-[#D4AF37]/40">
              <span className="flex items-center gap-2.5">
                <Scroll size={16} className="text-[#FFDF73] drop-shadow-[0_0_6px_rgba(255,215,0,0.7)]" />
                Quests &amp; Trials of the Realm
              </span>
            </th>
            {handles.map((h) => (
              <th
                key={h}
                className="border-l border-[#D4AF37]/35 px-4 py-4 text-center font-display text-xs font-extrabold uppercase tracking-wider text-[#FFF9F0] drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#D4AF37]/30 bg-[#2C2114]">
          {problems.map((p, idx) => (
            <tr
              key={p.id}
              className={`group/row transition-colors duration-200 hover:bg-[#4A3821] ${idx % 2 === 0 ? "scratchy-row-even" : "scratchy-row-odd"
                }`}
            >
              <td
                className={`sticky left-0 z-10 min-w-[260px] px-7 py-4 border-r border-[#D4AF37]/40 group-hover/row:bg-[#4A3821] transition-colors ${idx % 2 === 0 ? "scratchy-row-even" : "scratchy-row-odd"
                  }`}
              >
                <a
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex w-full items-center justify-between gap-4 text-left"
                >
                  <div className="flex flex-col gap-1 min-w-[200px]">
                    <span className="inline-block self-start rounded-md bg-gradient-to-r from-[#614725] to-[#3B2A14] px-2.5 py-0.5 font-display text-[11px] font-extrabold tabular-nums text-[#FFDF73] border border-[#D4AF37]/70 shadow-[0_1px_3px_rgba(0,0,0,0.85)]">
                      § {p.id}
                    </span>
                    <span className="block font-sans text-[15px] font-bold text-[#F7ECD8] transition-colors group-hover:text-[#FFDF73] drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                      {p.name}
                    </span>
                  </div>
                  <ExternalLink size={15} className="opacity-0 text-[#FFDF73] transition-opacity duration-200 group-hover:opacity-100 shrink-0 drop-shadow-[0_0_6px_#FFDF73]" />
                </a>
              </td>
              {handles.map((h) => (
                <StatusCell
                  key={h}
                  solved={Boolean(p.solvedBy[h])}
                  submissionUrl={p.submissionUrls?.[h]}
                  submissionId={p.submissionIds?.[h]}
                />
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[#D4AF37]/80 scratchy-table-tfoot shadow-inner">
            <td className="sticky left-0 z-10 scratchy-table-tfoot px-7 py-5 font-display text-[15px] font-black uppercase tracking-[0.24em] text-[#FFF4DE] drop-shadow-[0_2px_3px_rgba(0,0,0,1)] border-r border-[#D4AF37]/45">
              ❖ Conquered by Knight
            </td>
            {handles.map((h) => (
              <td
                key={h}
                className="border-l border-[#D4AF37]/40 px-4 py-5 text-center font-display tabular-nums text-[#E8D4AE]"
              >
                <span className="text-[#FFDF73] text-2xl font-black drop-shadow-[0_2px_3px_rgba(0,0,0,1),_0_0_15px_rgba(255,215,0,0.8)]">{countFor(h)}</span>
                <span className="text-sm font-extrabold text-[#D6B57E] ml-1">/ {problems.length}</span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
