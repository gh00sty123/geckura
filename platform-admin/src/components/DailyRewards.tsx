"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { FiGift } from "react-icons/fi";

export default function DailyRewards() {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const midNight = new Date();
  midNight.setHours(24, 0, 0, 0);
  const [claimed, setClaimed] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const activeDay = Math.floor(now / 86400) % 7;

  useEffect(() => {
    if (barRef.current && barRef.current.firstChild instanceof HTMLElement) {
      barRef.current.firstChild.style.transition = "width 0.6s ease-out";
      barRef.current.firstChild.style.width = claimed ? "100%" : "0%";
    }
  }, [claimed]);

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FiGift className="text-[#39ff14] text-lg" />
        <h3 className="text-sm font-bold text-white">Daily Reward</h3>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {[...Array(7)].map((_, i) => {
          const done   = i < activeDay || claimed;
          const active = i === activeDay;
          return (
            <div
              key={i}
              className={`aspect-square rounded-xl flex items-center justify-center text-xs font-bold
                ${done    ? "bg-[#39ff14]/20 text-[#39ff14] border border-[#39ff14]/30"
                  : active ? "bg-white/[0.06] border border-[#39ff14]/40 text-[#39ff14]/90"
                  : "bg-white/[0.04] border border-white/[0.08] text-gray-600"
                }`}
            >
              {done ? "✦" : i + 1}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500">Claimed today</p>
          <p className="text-sm font-bold text-white">
            {claimed ? "✦ 50 GEK claimed" : "Unclaimed"}
          </p>
        </div>
        {!claimed && (
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setClaimed(true)}
            className="px-4 py-2 rounded-xl bg-[#39ff14] text-black text-xs font-bold shadow-[0_0_14px_rgba(57,255,20,0.35)] hover:shadow-[0_0_28px_rgba(57,255,20,0.55)] transition-shadow cursor-pointer"
          >
            Claim Now
          </motion.button>
        )}
      </div>
    </div>
  );
}
