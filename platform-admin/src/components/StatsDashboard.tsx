"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import CountUp from "react-countup";
import { FiTrendingUp, FiZap, FiShield, FiArrowUp } from "react-icons/fi";
import { LuSparkles } from "react-icons/lu";
import type { UserStats } from "@/lib/mockData";

export default function StatsDashboard({ stats }: { stats: UserStats }) {
  const [shouldCount, setShouldCount] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShouldCount(true), 400);
    return () => clearTimeout(id);
  }, []);

  return (
    <section aria-label="Statistics" className="space-y-5">
      <div className="flex items-center gap-2">
        <LuSparkles className="text-[#1cac64]" />
        <h2 className="text-xl font-bold text-white">Your Statistics</h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        {[
          { icon: FiZap,      label: "Packs Opened",  value: stats.totalPacksOpened,        color: "text-[#1cac64]", bg: "bg-[#1cac64]/10" },
          { icon: FiShield,   label: "Luck Rating",   value: `${stats.luckPercentage}%`,    color: "text-purple-400", bg: "bg-purple-400/10" },
          { icon: FiTrendingUp, label: "Total Winnings", value: `${stats.totalWinnings.toFixed(2)} SOL`, color: "text-emerald-400", bg: "bg-emerald-400/10" },
          { icon: FiArrowUp,  label: "Live Jackpot",  value: `$${stats.jackpotPool.toLocaleString()}`, color: "text-amber-400", bg: "bg-amber-400/10" },
        ].map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.07, ease: "easeOut" }}
              className="glass-panel rounded-2xl p-5 group hover:bg-white/[0.04] transition-colors cursor-default"
            >
              <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${stat.bg} mb-3`}>
                <Icon className={`text-base ${stat.color}`} />
              </div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 font-medium">{stat.label}</p>
              <p className={`text-xl font-black tabular-nums mt-0.5 ${stat.color}`}>
                {shouldCount
                  ? typeof stat.value === "number"
                    ? <CountUp end={stat.value} duration={1.4} decimals={stat.value % 1 !== 0 ? 2 : 0} separator="," />
                    : stat.value
                  : "…"}
              </p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
