"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { FiX, FiCopy, FiExternalLink, FiInfo, FiShoppingBag } from "react-icons/fi";
import CountUp from "react-countup";
import type { PackItem, RarityTier } from "@/lib/mockData";
import { useAppStore } from "@/lib/store";
import { resolveIpfsUrl } from "@/lib/helpers";
import { useProjectBranding } from "@/lib/ProjectBrandingProvider";

const RARITY_COLORS: Record<RarityTier, string> = {
  common:    "#9ca3af",
  rare:      "#3b82f6",
  epic:      "#a855f7",
  legendary: "#f59e0b",
  mythic:    "#ef4444",
};

type Phase = "pre-spin" | "spinning" | "reveal" | "done";

interface WinMeta {
  name: string;
  rarity: RarityTier;
  image: string;
}

/* ══════════════════════════════════════════
   Simulate a realistic open from pack metadata
══════════════════════════════════════════ */
function simulateWin(pack: PackItem): WinMeta {
  const rarities: RarityTier[] = ["common", "rare", "epic", "legendary", "mythic"];
  const weights: number[] = pack.oddsPreview
    ? Object.values(pack.oddsPreview).map((v) => {
        const n = parseFloat(String(v).replace("%", ""));
        return isNaN(n) ? 50 : n;
      })
    : [50, 25, 15, 7, 3];

  const total = weights.reduce((a, b) => a + b, 0);
  const r = Math.random() * total;
  let acc = 0;
  let rarity: RarityTier = "common";
  for (let i = 0; i < rarities.length; i++) {
    acc += weights[i] ?? 50;
    if (r <= acc) { rarity = rarities[i]; break; }
  }

  const seeds = {
    common:    ["scale", "clawbase", "nano"],
    rare:      ["scale-blue", "neon-claw", "chrome-scale"],
    epic:      ["toxic-reptile", "galaxy-gecko", "phantom-ash"],
    legendary: ["genesis-view", "plasma-spine", "prime-orig"],
    mythic:    ["mythic-destroyer", "diamond-ape", "sacred-hex"],
  };
  const group = seeds[rarity] ?? seeds.common;
  const pick  = group[Math.floor(Math.random() * group.length)];

  return { name: `${rarity.charAt(0).toUpperCase() + rarity.slice(1)} NFT — ${pick}`, rarity, image: `https://picsum.photos/seed/${pick}/400/400` };
}

/* ══════════════════════════════════════════
   Pack Opening Experience
══════════════════════════════════════════ */
export default function PackOpening({
  isOpen,
  packName,
  onClose,
  onComplete,
}: {
  isOpen: boolean;
  packName: string;
  onClose: () => void;
  onComplete: (item: { name: string; rarity: RarityTier; image: string }) => void;
}) {
  const branding = useProjectBranding();
  const [phase, setPhase]   = useState<Phase>("pre-spin");
  const [win, setWin]       = useState<WinMeta | null>(null);
  const [confetti, setConfetti] = useState<Array<{ id: number; color: string; left: number; delay: number; size: number }>>([]);
  const confettiRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const particles = useMemo(() => {
    if (!win || phase !== "reveal") return [];
    const count = win.rarity === "mythic" ? 40 : win.rarity === "legendary" ? 28 : 16;
    return Array.from({ length: count }).map((_, i) => ({
      id: i,
      left: `${(i * 17 + 23) % 100}%`,
      fontSize: `${8 + (i * 7 + 11) % 9}px`,
      initialRotate: (i * 29 + 41) % 360,
      animateRotate: 720 + ((i * 53 + 97) % 720),
    }));
  }, [win, phase]);

  const startOpen  = () => setPhase("spinning");
  const resetAndClose = () => { setWin(null); setPhase("pre-spin"); onClose(); };

  useEffect(() => {
    if (isOpen) return;
    confettiRef.current = setTimeout(() => setConfetti([]), 800);
    return () => clearTimeout(confettiRef.current);
  }, [isOpen]);

  const count = win ? 1 : 6;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/92 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* ── Ambient glow ── */}
          {win && (
            <motion.div
              className="pointer-events-none absolute rounded-full"
              style={{ width: 700, height: 700, background: `radial-gradient(circle, ${RARITY_COLORS[win.rarity]}35 0%, transparent 70%)` }}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: phase === "done" ? 1.2 : 0.9, opacity: phase === "done" ? 1 : 0.6 }}
              transition={{ duration: 0.8 }}
            />
          )}

          {/* ── Close ── */}
          <button
            onClick={resetAndClose}
            className="absolute top-5 right-5 h-10 w-10 rounded-full bg-[#1cac64]/6 border border-white/[0.1]
              flex items-center justify-center text-[#1a3a2a] hover:text-[#0f2618] hover:bg-white/[0.12]
              transition-all z-20 cursor-pointer"
          >
            <FiX />
          </button>

          {/* ── Main animation container ── */}
          <div className="relative w-full max-w-xl px-6">

            {/* Pack name header */}
            <div className="text-center mb-8">
              <p className="text-xs uppercase tracking-[0.2em] text-[#1cac64]/50 mb-1">Opening</p>
              <h2
                className="text-2xl font-bold text-[#0f2618] neon-text"
                style={{ textShadow: "0 0 24px rgba(28,172,100,.7)" }}
              >
                {packName}
              </h2>
            </div>

            {/* ── Pre-spin ── */}
            {phase === "pre-spin" && (
              <motion.div
                className="flex flex-col items-center gap-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45 }}
              >
                <div className="relative h-48 w-40 rounded-2xl bg-[#1cac64]/3 border border-[#1cac64]/12 flex items-center justify-center overflow-hidden">
                  {branding.logoUrl ? (
                    <img src={branding.logoUrl} alt="Project Logo" className="w-24 h-24 object-contain rounded-2xl" />
                  ) : (
                    <span className="text-6xl">🎁</span>
                  )}
                </div>
                <motion.button
                  onClick={() => {
                    startOpen();
                    setTimeout(() => {
                      const result = simulateWin(
                        {
                          id: "ph", name: packName, description: "",
                          image: "", category: "community", categoryLabel: "Community",
                          price: 1, supplyLeft: 100, totalSupply: 100,
                          oddsPreview: { Common: "60%", Rare: "30%", Epic: "8%", Legendary: "2%" },
                        } as PackItem,
                      );
                      setWin(result);
                    }, 2500);
                    setTimeout(() => {
                      setPhase("reveal");
                    }, 3200);
                    setTimeout(() => {
                      setPhase("done");
                      onComplete(win ?? simulateWin({
                        id: "ph2", name: packName, description: "",
                        image: "", category: "community", categoryLabel: "Community",
                        price: 1, supplyLeft: 100, totalSupply: 100,
                        oddsPreview: {},
                      } as PackItem));
                    }, 6000);
                  }}
                  whileHover={{ scale: 1.07 }}
                  whileTap={{ scale: 0.95 }}
                  className="rounded-2xl bg-gradient-to-r from-[#1cac64] to-emerald-500 px-10 py-4 text-black
                    font-bold text-lg shadow-[0_0_32px_rgba(28,172,100,0.55)] cursor-pointer"
                >
                  TAP TO OPEN
                </motion.button>
              </motion.div>
            )}

            {/* ── Spinning ── */}
            {phase === "spinning" && (
              <div className="flex flex-col items-center gap-6">
                <div className="relative h-48 w-40 rounded-2xl bg-gradient-to-br from-[#1cac64]/15 to-emerald-500/10 border border-[#1cac64]/40 flex items-center justify-center overflow-hidden">
                  {/* Animating question marks */}
                  {Array.from({ length: count }).map((_, i) => (
                    <motion.span
                      key={i}
                      className="absolute text-6xl font-black select-none"
                      animate={{ y: [-200, 0, -100], opacity: [0, 1, 0] }}
                      transition={{
                        duration: 0.65 + i * 0.08,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                      style={{ top: "50%", left: `${(i * 100) / count}%`, transform: "translateX(-50%)" }}
                    >
                      ?
                    </motion.span>
                  ))}
                  <span className="relative font-black text-6xl z-10">?</span>
                </div>
                <p className="text-sm text-[#2d5a3f] pulse-neon">Drawing your reward…</p>
              </div>
            )}

            {/* ── Reveal ── */}
            {phase === "reveal" && win && (
              <motion.div
                className="flex flex-col items-center gap-5"
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 350, damping: 18 }}
              >
                <AnimatePresence>
                  {particles.map((p) => (
                    <motion.span
                      key={p.id}
                      className="fixed top-0 h-3 w-1 pointer-events-none font-bold text-xs"
                      style={{
                        color: RARITY_COLORS[win.rarity] ?? "#fff",
                        left: p.left,
                        fontSize: p.fontSize,
                      }}
                      initial={{ y: -60, rotate: p.initialRotate, opacity: 1 }}
                      animate={{ y: 600, rotate: p.animateRotate, opacity: 0 }}
                      transition={p.id === 0 ? { duration: 1.6, ease: "easeOut" } : {}}
                    >
                      ★
                    </motion.span>
                  ))}
                </AnimatePresence>

                <div
                  className="relative rounded-3xl overflow-hidden neon-glow-lg pt-8"
                  style={{ border: `2px solid ${RARITY_COLORS[win.rarity]}` }}
                >
                  <img
                    src={resolveIpfsUrl(win.image)}
                    alt={win.name}
                    className="block h-[300px] w-[260px] object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                  <div className="absolute inset-0 animate-pulse"
                    style={{
                      boxShadow: `inset 0 0 80px ${RARITY_COLORS[win.rarity] ?? "#fff"}40`,
                    }}
                  />
                </div>

                <div className="text-center">
                  <p
                    className="font-black text-4xl uppercase tracking-[0.25em] mb-1"
                    style={{ color: RARITY_COLORS[win.rarity], textShadow: `0 0 30px ${RARITY_COLORS[win.rarity]}70` }}
                  >
                    {win.rarity.toUpperCase()}
                  </p>
                  <p className="text-base font-bold text-[#0f2618]">{win.name}</p>
                </div>

                <motion.button
                  onClick={() => { onClose(); if (win) onComplete(win); }}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.96 }}
                  className="rounded-2xl bg-[#1cac64] px-10 py-4 text-black font-bold shadow-[0_0_32px_rgba(28,172,100,0.5)] cursor-pointer"
                >
                  Claim Reward
                </motion.button>
              </motion.div>
            )}

            {/* ── Done ── */}
            {phase === "done" && win && (
              <motion.div
                className="flex flex-col items-center gap-5"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 350, damping: 18 }}
              >
                {win.rarity === "mythic" && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: [0, 1, 1, 0], y: [-10, 0, 0, -10] }}
                    transition={{ duration: 3, repeat: Infinity }}
                    className="text-red-500 font-black uppercase tracking-[0.2em] text-xl"
                  >
                    ⚡ JACKPOT MYTHIC ⚡
                  </motion.p>
                )}
                <p className="text-[#2d5a3f] text-sm">Reward eligible to claim.</p>
                <motion.button
                  onClick={resetAndClose}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.96 }}
                  className="rounded-2xl bg-[#1cac64]/8 border border-white/[0.12] px-10 py-4
                    text-[#0f2618] font-semibold hover:bg-white/[0.12] transition-all cursor-pointer"
                >
                  Done
                </motion.button>
              </motion.div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
