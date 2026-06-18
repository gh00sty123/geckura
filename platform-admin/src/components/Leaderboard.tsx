"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiAward, FiArrowUp, FiTrendingUp } from "react-icons/fi";
import CountUp from "react-countup";
import type { LeaderEntry } from "@/lib/mockData";
import { resolveIpfsUrl } from "@/lib/helpers";

export default function Leaderboard({ data }: { data: LeaderEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const idx = setInterval(() => {
      setHighlighted((prev) => (prev === null ? 0 : (prev + 1) % data.length));
    }, 4000);
    return () => clearInterval(idx);
  }, [data.length]);

  return (
    <div className="glass-panel rounded-2xl overflow-hidden space-y-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 pt-5 pb-3">
        <FiAward className="text-amber-400 text-base" />
        <h3 className="text-sm font-bold text-[#0f2618]">Leaderboard</h3>
      </div>

      {/* Rankings */}
      <div ref={scrollRef} className="pr-1 pb-4 space-y-1">
        {data.map((entry, i) => {
          const rankColor =
            i === 0 ? "text-amber-400" :
            i === 1 ? "text-[#1a3a2a]" :
            i === 2 ? "text-amber-600" : "text-[#3d6b4e]";
          const highlight = highlighted === i;

          return (
            <motion.div
              key={entry.rank}
              initial={{ opacity: 0, x: -10 }}
              animate={{
                opacity: 1, x: 0,
                background: highlight ? "rgba(255,255,255,0.03)" : "transparent",
              }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-300"
            >
              <span className={`text-sm font-black w-6 shrink-0 ${rankColor}`}>
                #{entry.rank}
              </span>
              <img
                src={resolveIpfsUrl(entry.avatar)}
                alt={entry.username}
                className="h-7 w-7 rounded-full bg-[#1a1a1a] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#1a3a2a] truncate">{entry.username}</p>
                <div className="flex items-center gap-1 text-[10px] text-[#3d6b4e]">
                  <FiTrendingUp className="text-[#1cac64]" /> +2.4%
                </div>
              </div>
              <span className="text-xs font-bold text-[#1cac64] tabular-nums">
                <CountUp end={entry.value} duration={0.6} decimals={1} prefix="$" separator="," />
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
