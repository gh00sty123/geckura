"use client";

import { motion } from "framer-motion";
import { FiTag, FiBox, FiDollarSign } from "react-icons/fi";
import { LuSwords } from "react-icons/lu";
import type { PackItem } from "@/lib/mockData";

const RARITY_COLORS: Record<string, { border: string; glow: string; text: string; badge: string }> = {
  legendary: { border: "border-amber-400/40", glow: "shadow-[0_0_20px_rgba(245,158,11,0.3)]", text: "text-amber-400",      badge: "bg-amber-400/15 text-amber-300" },
  epic:       { border: "border-purple-400/40", glow: "shadow-[0_0_20px_rgba(168,85,247,0.3)]", text: "text-purple-400",    badge: "bg-purple-400/15 text-purple-200" },
  rare:       { border: "border-blue-400/40",   glow: "shadow-[0_0_20px_rgba(59,130,246,0.3)]", text: "text-blue-400",     badge: "bg-blue-400/15 text-blue-200" },
  common:     { border: "border-gray-400/40",   glow: "",                                         text: "text-gray-400",     badge: "bg-gray-400/15 text-gray-300" },
};

function RarityMap(name: string) {
  const n = name.toLowerCase();
  if (n.includes("legendary") || n.includes("vault")) return RARITY_COLORS.legendary;
  if (n.includes("cyber")    || n.includes("phantom") || n.includes("hex") || n.includes("god")) return RARITY_COLORS.epic;
  if (n.includes("gecko")  || n.includes("chrome"))  return RARITY_COLORS.rare;
  return RARITY_COLORS.common;
}

function SupplyBar({ used, total }: { used: number; total: number }) {
  const pct = Math.min(100, ((total - used) / total) * 100);
  const isLow = pct <= 10;
  return (
    <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        className={`h-full rounded-full ${isLow ? "bg-red-500/70" : "bg-[#1cac64]/55"}`}
      />
    </div>
  );
}

export default function PackCard({
  pack,
  onOpen,
  index,
}: {
  pack: PackItem;
  onOpen: (name: string) => void;
  index: number;
}) {
  const style = RarityMap(pack.name);
  const sold = pack.totalSupply - pack.supplyLeft;
  const glowClass = style.glow;

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.45,
        delay: index * 0.055,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      className={`group relative rounded-2xl overflow-hidden border ${style.border} bg-[#0f0f0f] transition-all
        duration-400 hover:bg-[#191919] ${glowClass} card-hover`}
    >
      {/* Top gradient shimmer strip */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#1cac64]/40 to-transparent opacity-40 group-hover:opacity-100 transition-opacity" />

      <div className="p-5">
        {/* Pack header: icon + info */}
        <div className="flex items-start gap-3">
          {/* Pack artwork area */}
          <div className="relative h-18 w-18 flex-shrink-0 rounded-xl overflow-hidden border border-white/[0.08]
            bg-gradient-to-br from-[#1cac64]/10 to-emerald-500/5 flex items-center justify-center">
            <LuSwords className="text-[#1cac64] text-3xl drop-shadow-lg" />

            {/* Subtle animated glow on hover */}
            <div
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity
              duration-500 blur-md"
              style={{
                background: style.text === "text-amber-400" ? "#f59e0b40" :
                           style.text === "text-purple-400" ? "#a855f740" :
                           style.text === "text-blue-400"   ? "#3b82f640" :
                           "#1cac6440",
              }}
            />
          </div>

          {/* Name + price + badge */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.badge}`}>
                {pack.categoryLabel}
              </span>
            </div>
            <h3 className="mt-1 text-base font-bold text-white leading-tight group-hover:text-[#1cac64] transition-colors">
              {pack.name}
            </h3>
            <p className="text-[11px] text-gray-600 mt-0.5 line-clamp-1">{pack.description}</p>

            <div className="flex items-center justify-between mt-2.5">
              <div className="flex items-center gap-1 text-base font-extrabold text-[#1cac64]">
                <FiDollarSign className="text-sm opacity-70" />
                {pack.price} <span className="text-xs font-medium text-gray-500">SOL</span>
              </div>
              <span className="text-[11px] text-gray-500">
                {pack.supplyLeft.toLocaleString()} left
              </span>
            </div>
          </div>
        </div>

        {/* Odds preview strip */}
        {pack.oddsPreview && Object.keys(pack.oddsPreview).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {Object.entries(pack.oddsPreview).map(([rarity, pct]) => {
              const r = RARITY_COLORS[rarity.toLowerCase() as keyof typeof RARITY_COLORS] ?? RARITY_COLORS.common;
              return (
                <span
                  key={rarity}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border border-white/[0.07] ${r.badge}`}
                >
                  {rarity} {pct}
                </span>
              );
            })}
          </div>
        )}

        {/* Supply bar */}
        <SupplyBar used={sold} total={pack.totalSupply} />

        {/* CTA */}
        <motion.button
          onClick={() => onOpen(pack.name)}
          className="mt-4 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] py-2.5
            text-sm font-semibold text-white hover:bg-[#1cac64]/10 hover:border-[#1cac64]/30
            hover:text-[#1cac64] transition-all duration-300"
          whileHover={{ scale: 1.022 }}
          whileTap={{ scale: 0.97 }}
        >
          Open Now
        </motion.button>
      </div>

      {/* Sale label (low supply) */}
      {pack.supplyLeft === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm z-10">
          <span className="text-sm font-bold text-red-500 uppercase tracking-wider">Sold Out</span>
        </div>
      )}

      {/* Card bottom glow */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#1cac64]/25 to-transparent opacity-50" />
    </motion.div>
  );
}
