"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiShoppingBag, FiGrid } from "react-icons/fi";
import { LuSparkles, LuSwords, LuBug, LuFlame, LuTreeDeciduous } from "react-icons/lu";
import { RiEmojiStickerLine } from "react-icons/ri";
import type { PackCategory, PackItem } from "@/lib/mockData";
import type { AppState } from "@/lib/store";
import PackCard from "./PackCard";

const CATEGORIES: { key: PackCategory | "all"; label: string; icon: React.ReactNode }[] = [
  { key: "all",            label: "All Packs",         icon: <FiGrid /> },
  { key: "limited",        label: "Limited Drops",     icon: <LuSparkles /> },
  { key: "community",      label: "Community Packs",   icon: <RiEmojiStickerLine /> },
  { key: "seasonal",       label: "Seasonal Packs",    icon: <LuFlame /> },
  { key: "legendary_vault", label: "Legendary Vaults", icon: <LuSwords /> },
];

export default function PackGrid({
  packs,
  categoryFilter,
  setCategoryFilter,
  onOpenPack,
}: {
  packs: PackItem[];
  categoryFilter: PackCategory | "all";
  setCategoryFilter: AppState["setCategoryFilter"];
  onOpenPack: (name: string) => void;
}) {
  const filtered = useMemo(
    () => (categoryFilter === "all" ? packs : packs.filter((p) => p.category === categoryFilter)),
    [packs, categoryFilter],
  );

  return (
    <section aria-label="Mystery Packs" className="space-y-6">
      {/* Section head */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Mystery Packs</h2>
          <p className="mt-1 text-xs text-gray-500">
            {filtered.length} pack{filtered.length !== 1 ? "s" : ""} available · scroll to see more
          </p>
        </div>
      </div>

      {/* Category bar */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {CATEGORIES.map((cat) => {
          const active = categoryFilter === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setCategoryFilter(cat.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all
                ${active
                  ? "bg-[#39ff14] text-[#0a0a0a] shadow-[0_0_18px_rgba(57,255,20,0.35)]"
                  : "bg-white/[0.04] border border-white/[0.08] text-gray-400 hover:bg-white/[0.07] hover:text-gray-200"
                }`}
            >
              {cat.icon}
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <motion.div
        key={categoryFilter}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
      >
        <AnimatePresence mode="popLayout">
          {filtered.map((pack, i) => (
            <PackCard key={pack.id} pack={pack} onOpen={onOpenPack} index={i} />
          ))}
        </AnimatePresence>
      </motion.div>

      {filtered.length === 0 && (
        <div className="py-16 text-center text-gray-500 text-sm">
          No packs in this category yet.
        </div>
      )}
    </section>
  );
}
