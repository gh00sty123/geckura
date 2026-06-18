"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import { FiAward, FiZap, FiInfo } from "react-icons/fi";
import type { BigWin, RarityTier } from "@/lib/mockData";
import { resolveIpfsUrl } from "@/lib/helpers";

const RARITY_COLORS: Record<RarityTier, string> = {
  common:    "#9ca3af",
  rare:      "#3b82f6",
  epic:      "#a855f7",
  legendary: "#f59e0b",
  mythic:    "#ef4444",
};

export default function BigWinsCarousel({ wins }: { wins: BigWin[] }) {
  const [active, setActive] = useState(0);
  const timer   = useRef<ReturnType<typeof setInterval>>(undefined);
  const len     = wins.length;

  useEffect(() => {
    timer.current = setInterval(() => {
      setActive((p) => (p + 1) % len);
    }, 4000);
    return () => clearInterval(timer.current);
  }, [len]);

  const win = wins[active];
  const rc  = RARITY_COLORS[win.rarity] ?? "#1cac64";

  return (
    <section aria-label="Big Wins" className="space-y-5">
      <div className="flex items-center gap-2">
        <FiAward className="text-[#1cac64] text-lg" />
        <h2 className="text-xl font-bold text-[#0f2618]">Recent Big Wins</h2>
      </div>

      {/* Carousel track */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#111]/80">
        <AnimatePresence mode="wait">
          <motion.div
            key={win.id}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            transition={{ duration: 0.45, ease: "easeInOut" }}
            className="relative flex flex-col lg:flex-row items-stretch"
          >
            {/* Image */}
            <div className="relative h-48 lg:h-auto lg:w-[55%] shrink-0 overflow-hidden">
              <img
                src={resolveIpfsUrl(win.image)}
                alt={win.reward}
                className="w-full h-full object-cover"
              />
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-transparent to-transparent lg:bg-gradient-to-r" />

              {/* Rarity glow badge */}
              <div className="absolute top-4 left-4 backdrop-blur-md px-3 py-1.5 rounded-full border font-bold text-xs flex items-center gap-1.5"
                style={{ background: `${rc}20`, borderColor: `${rc}50`, color: rc }}
              >
                <FiZap /> {win.rarity.toUpperCase()}
              </div>
            </div>

            {/* Info */}
            <div className="flex flex-col gap-3 p-6 lg:p-8">
              <p className="text-[11px] text-[#3d6b4e] uppercase tracking-wider">User</p>
              <p className="text-lg font-bold text-[#0f2618]">{win.username}</p>

              <div>
                <p className="text-[11px] text-[#3d6b4e] uppercase tracking-wider mb-1">Reward pulled</p>
                <p className="text-base font-semibold" style={{ color: rc }}>{win.reward}</p>
              </div>

              <p className="text-[11px] text-[#4a7d5e]">{new Date(win.timestamp).toLocaleString()}</p>
            </div>

            {/* Holographic edge glow */}
            <div
              className="absolute bottom-0 left-0 right-0 h-[3px]"
              style={{
                background: `linear-gradient(90deg, transparent, ${rc}, transparent)`,
                boxShadow: `0 0 18px ${rc}80`,
              }}
            />
          </motion.div>
        </AnimatePresence>

        {/* Dot indicators */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
          {wins.map((w, i) => (
            <button
              key={w.id}
              onClick={() => { setActive(i); clearInterval(timer.current); }}
              className={`h-1.5 rounded-full transition-all duration-300
                ${i === active ? "w-5 bg-[#1cac64]" : "w-2 bg-white/20 hover:bg-white/40"}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
