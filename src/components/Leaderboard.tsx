import type { Handle } from "@/data/tracker";
import { Tile } from "./Tile";
import { Crown, Medal, Shield } from "lucide-react";

export type LeaderRow = { handle: Handle; solved: number; total: number };

export function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  const top = rows[0]?.solved || 1;

  return (
    <Tile className="p-6">
      <div className="flex items-baseline justify-between border-b border-[#AF8032]/30 pb-3">
        <h2 className="font-display text-base font-bold tracking-wider text-[#8C621C] uppercase drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
          ❖ Order of Champions ❖
        </h2>
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-[#7D6346]">
          Eternal Record
        </span>
      </div>
      <ol className="mt-5 space-y-3.5">
        {rows.map((r, i) => {
          const isTop = i === 0;
          const isSecond = i === 1;
          const isThird = i === 2;

          let rankIcon = <span className="w-6 font-display text-sm font-extrabold tabular-nums text-[#947852] text-center">{i + 1}.</span>;
          if (isTop) rankIcon = <Crown size={20} className="text-[#A87B20] fill-[#A87B20]/25 drop-shadow-[0_1px_2px_rgba(150,110,30,0.3)] shrink-0" />;
          else if (isSecond) rankIcon = <Medal size={19} className="text-[#647287] fill-[#647287]/20 drop-shadow-[0_1px_2px_rgba(100,110,130,0.25)] shrink-0" />;
          else if (isThird) rankIcon = <Shield size={18} className="text-[#A85D2A] fill-[#A85D2A]/20 drop-shadow-[0_1px_2px_rgba(150,85,40,0.25)] shrink-0" />;

          return (
            <li
              key={r.handle}
              className={`rounded-lg transition-all duration-300 ${
                isTop
                  ? "bg-gradient-to-r from-[#FAEDE0]/85 via-[#FDF9F0]/90 to-transparent border-l-4 border-[#B88B2A] py-2.5 px-3.5 shadow-[0_2px_12px_rgba(150,110,30,0.12)]"
                  : isSecond
                  ? "bg-gradient-to-r from-[#EAECEF]/80 via-[#F5F7FA]/85 to-transparent border-l-4 border-[#738096] py-2 px-3"
                  : isThird
                  ? "bg-gradient-to-r from-[#F7E6D8]/80 via-[#FBF4EE]/85 to-transparent border-l-4 border-[#B26B36] py-2 px-3"
                  : "py-1.5 px-3 hover:bg-[#F0E4D0]/70"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3 truncate">
                  <div className="flex w-6 justify-center">{rankIcon}</div>
                  <span
                    className={`truncate font-display text-base tracking-wide ${
                      isTop
                        ? "font-black text-[#63450F]"
                        : isSecond
                        ? "font-bold text-[#3B475A]"
                        : isThird
                        ? "font-bold text-[#7A4117]"
                        : "font-semibold text-[#3D2C1E]"
                    }`}
                  >
                    {r.handle}
                  </span>
                </span>
                <span className="font-display text-sm font-black tabular-nums text-[#2A1C12]">
                  {r.solved} <span className="text-[#7D6346] font-semibold text-xs">/ {r.total}</span>
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#E8DCC6] border border-[#B88A35]/35 shadow-inner">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    isTop
                      ? "bg-gradient-to-r from-[#D4A038] via-[#B88624] to-[#8C621C] shadow-[0_1px_4px_rgba(165,120,30,0.4)]"
                      : isSecond
                      ? "bg-gradient-to-r from-[#94A0B3] to-[#59667A]"
                      : isThird
                      ? "bg-gradient-to-r from-[#C98A55] to-[#8C5226]"
                      : "bg-gradient-to-r from-[#C2AC82] to-[#997F56]"
                  }`}
                  style={{ width: `${(r.solved / top) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </Tile>
  );
}
