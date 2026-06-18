"use client";

import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiFilter } from "react-icons/fi";
import type { DrawRecord, RarityTier } from "@/lib/mockData";
import type { AppState } from "@/lib/store";
import { resolveIpfsUrl } from "@/lib/helpers";

const RARITY_COLORS: Record<RarityTier, string> = {
  common:    "#9ca3af",
  rare:      "#3b82f6",
  epic:      "#a855f7",
  legendary: "#f59e0b",
  mythic:    "#ef4444",
};

function timeAgo(t: number) {
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60)   return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function RarityBadge({ rarity }: { rarity: RarityTier }) {
  const c = RARITY_COLORS[rarity];
  return (
    <span
      className="inline-flex text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: `${c}22`, color: c, border: `1px solid ${c}40` }}
    >
      {rarity}
    </span>
  );
}

/* ══════════════════════════════════════════ */
function LiveDrawHistory({
  draws, rarityFilter, setDrawRarityFilter,
}: {
  draws: DrawRecord[];
  rarityFilter: string;
  setDrawRarityFilter: AppState["setDrawRarityFilter"];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const filtered = rarityFilter === "all"
    ? draws
    : draws.filter((d) => d.rarity === (rarityFilter as RarityTier));

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [rarityFilter]);

  return (
    <section aria-label="Live Draw History" className="glass-panel rounded-2xl overflow-hidden flex flex-col h-full border border-white/[0.06]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1cac64] opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1cac64]" />
          </span>
          <h3 className="text-sm font-bold text-white">Live Draw History</h3>
          <span className="text-[10px] text-gray-500 ml-1">• Live</span>
        </div>

        <div className="flex items-center gap-1">
          <FiFilter className="text-gray-500 text-xs" />
          <select
            value={rarityFilter}
            onChange={(e) => setDrawRarityFilter(e.target.value)}
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg text-[11px] text-gray-300
                       px-2.5 py-1 outline-none focus:border-[#1cac64]/40 transition-colors cursor-pointer"
          >
            {["all", "common", "rare", "epic", "legendary", "mythic"].map((r) => (
              <option key={r} value={r} className="bg-[#111] text-gray-200 capitalize">
                {r === "all" ? "All rarities" : r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="p-6 text-center text-xs text-gray-600">No draws for this rarity</p>
        )}

        {filtered.map((draw, i) => (
          <DrawRow key={draw.id} draw={draw} index={i} />
        ))}
      </div>
    </section>
  );
}

function DrawRow({ draw, index }: { draw: DrawRecord; index: number }) {
  const rarityColor = RARITY_COLORS[draw.rarity];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.32, delay: index * 0.04, ease: "easeOut" }}
      className="flex items-center gap-3.5 px-5 py-3 hover:bg-white/[0.02] transition-colors border-b border-white/[0.04] last:border-b-0"
    >
      {/* Rank */}
      <span className="text-[11px] font-semibold text-gray-700 w-4 shrink-0 text-right">
        #{index + 1}
      </span>

      {/* Avatar */}
      <img
        src={resolveIpfsUrl(draw.avatarUrl)}
        alt={draw.username}
        className="h-8 w-8 rounded-full bg-[#1a1a1a] ring-1 ring-white/[0.08] shrink-0"
      />

      {/* Identity */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-300 truncate">{draw.username}</p>
        <p className="text-[11px] text-gray-500 truncate">{draw.packName}</p>
      </div>

      {/* Win badge */}
      <div className="flex-1 text-right min-w-0">
        <RarityBadge rarity={draw.rarity} />
        <p
          className="text-[11px] font-semibold truncate mt-0.5"
          style={{ color: rarityColor }}
        >
          {draw.reward}
        </p>
      </div>

      {/* Timestamp */}
      <span className="text-[10px] text-gray-700 shrink-0 w-14 text-right">
        {timeAgo(draw.timestamp)}
      </span>
    </motion.div>
  );
}

export { LiveDrawHistory };
