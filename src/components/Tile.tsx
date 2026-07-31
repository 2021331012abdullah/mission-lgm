import type { ReactNode } from "react";

export function Tile({
  className = "",
  children,
  ornate = true,
}: {
  className?: string;
  children: ReactNode;
  ornate?: boolean;
}) {
  return (
    <div
      className={`glass glass-hover rounded-xl border border-[#AF8032]/45 relative overflow-hidden ${className}`}
    >
      {ornate && (
        <>
          <span className="pointer-events-none absolute top-1.5 left-2 text-[11px] text-[#A67523]/60 select-none font-bold">✦</span>
          <span className="pointer-events-none absolute top-1.5 right-2 text-[11px] text-[#A67523]/60 select-none font-bold">✦</span>
          <span className="pointer-events-none absolute bottom-1.5 left-2 text-[11px] text-[#A67523]/60 select-none font-bold">✦</span>
          <span className="pointer-events-none absolute bottom-1.5 right-2 text-[11px] text-[#A67523]/60 select-none font-bold">✦</span>
        </>
      )}
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <Tile className="p-6 text-center sm:text-left">
      <p className="font-display text-[12px] font-bold uppercase tracking-[0.22em] text-[#8C621C] drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]">
        {label}
      </p>
      <div className="my-2.5 h-[1px] w-full bg-gradient-to-r from-[#A67523]/10 via-[#A67523]/40 to-transparent" />
      <p className="mt-1 font-display text-4xl font-black tabular-nums text-[#2A1C12] drop-shadow-[0_1px_1px_rgba(255,255,255,0.9)]">
        {value}
        {suffix ? (
          <span className="ml-1 font-display text-xl font-bold text-[#8C621C]">{suffix}</span>
        ) : null}
      </p>
      {hint ? (
        <p className="mt-2 font-sans text-sm font-semibold italic text-[#7D6346]">
          &laquo; {hint} &raquo;
        </p>
      ) : null}
    </Tile>
  );
}
