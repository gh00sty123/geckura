"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import CountUp from "react-countup";
import {
  FiShoppingBag, FiChevronRight, FiStar, FiBox,
} from "react-icons/fi";
import { LuSwords, LuSparkles } from "react-icons/lu";
import type { PackItem } from "@/lib/mockData";

/* ══════════════════════════════════════════
   Ticker — infinite scrolling wins
══════════════════════════════════════════ */
function Ticker({ items }: { items: string[] }) {
  const doubled = [...items, ...items];
  return (
    <div className="overflow-hidden">
      <div className="ticker-anim flex gap-10 whitespace-nowrap text-sm text-gray-400">
        {doubled.map((t, i) => (
          <span key={i} className="flex items-center gap-2">
            <FiStar className="text-[#39ff14] text-xs" />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   Stat cards row
══════════════════════════════════════════ */
function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="glass-panel rounded-2xl px-5 py-4 flex items-center gap-3.5 min-w-0">
      <div className="flex-shrink-0 h-10 w-10 rounded-xl bg-[#39ff14]/10 flex items-center justify-center">
        <Icon className="text-[#39ff14] text-lg" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-gray-500">{label}</p>
        <p className="text-lg font-bold text-white leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-[#39ff14]/60">{sub}</p>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   HERO
══════════════════════════════════════════ */
export default function Hero({
  onOpenPack,
}: {
  onOpenPack: (packName: string) => void;
}) {
  const [jackpot, setJackpot] = useState(25_431.72);
  const containerRef = useRef<HTMLDivElement>(null);

  const wins = [
    "0xWizard won a Mythic Diamond Ape",
    "GeckoGuru won a Legendary Geckura #0842",
    "NeonFiona won an Epic Toxic Reptile",
    "LunaStack won a Rare Neon Claw",
    "ByteBaron won a Mythic Sacred Hex",
    "MoonKid won a Legendary Plasma Spine",
  ];

  useEffect(() => {
    const id = setInterval(() => {
      setJackpot((p) => p + Math.random() * 0.84);
    }, 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <section
      ref={containerRef}
      className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-[linear-gradient(135deg,#0d1118_0%,#0a0a0a_40%,#0a1208_100%)]"
    >
      {/* ── Background particle field ── */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <ParticleField />
      </div>

      {/* ── Left label — live badge ── */}
      <div className="pointer-events-none absolute top-6 left-6 z-10">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] font-semibold text-[#39ff14]/70">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#39ff14] opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#39ff14]" />
          </span>
          Live Now
        </span>
      </div>

      {/* ── Main grid ── */}
      <div className="relative z-10 grid lg:grid-cols-[1fr_380px] gap-8 lg:gap-12 p-6 sm:p-10 lg:p-14">

        {/* Left column */}
        <div className="flex flex-col justify-center gap-8">

          {/* Headline */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <h1 className="text-4xl sm:text-5xl lg:text-[56px] font-black leading-[1.05] tracking-tight">
              <span className="text-white">Premium </span>
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#39ff14] via-emerald-400 to-[#22c55e]">
                Geckura Mystery
              </span>
              <br />
              <span className="text-white">Boxes</span>
            </h1>
            <p className="mt-4 text-base text-gray-400 max-w-md leading-relaxed">
              Unlock rare NFT collectibles from Solana&apos;s most exciting mystery drop ecosystem — real-time odds, provably fair, instant settlements.
            </p>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex flex-wrap items-center gap-4 animate-pulse-slow"
          >
            <motion.button
              onClick={() => onOpenPack("Gecko Genesis")}
              className="group relative flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[#39ff14] to-emerald-500 px-8 py-4 text-black font-extrabold text-lg shadow-[0_0_32px_rgba(57,255,20,0.5)]"
              whileHover={{ scale: 1.055, boxShadow: "0 0 64px rgba(57,255,20,0.7)" }}
              whileTap={{ scale: 0.96 }}
            >
              <svg className="w-6 h-6" viewBox="0 0 28 28" fill="none">
                <rect x="2"  y="2"  width="24" height="24" rx="6"
                  fill="black" stroke="#39ff14" strokeWidth="1.5" />
                <text x="14" y="19" textAnchor="middle" fontSize="13"
                  fill="#39ff14" fontFamily="sans-serif" fontWeight="bold">?</text>
              </svg>
              Open Mystery Pack
              <FiChevronRight className="text-xl transition-transform group-hover:translate-x-1.5" />
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className="flex items-center gap-2 rounded-2xl bg-white/[0.04] border border-white/[0.1] px-6 py-4 text-sm font-semibold text-white hover:bg-white/[0.08] transition-all"
            >
              <FiBox className="text-[#39ff14]" />
              Browse All Packs
            </motion.button>
          </motion.div>
        </div>

        {/* Right column — featured pack */}
        <motion.div
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative flex items-center justify-center py-8"
        >
          {/* Ambient glow behind pack */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-72 h-72 rounded-full opacity-30 blur-[80px] bg-[#39ff14]/20" />
            <div className="absolute w-48 h-48 rounded-full opacity-20 blur-[60px] bg-emerald-500/30" />
          </div>

          {/* Featured pack card — doubled height for 3D effect */}
          <div className="relative float-anim">
            <FeaturedPack onOpen={onOpenPack} />
          </div>

          {/* Scroll hint */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 text-gray-600">
            <span className="text-[10px] uppercase tracking-[0.2em]">Scroll</span>
            <motion.div
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="text-xs"
            >
              ↓
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════
   Featured (hero) mini pack
══════════════════════════════════════════ */
function FeaturedPack({ onOpen }: { onOpen: (n: string) => void }) {
  const packs: PackItem[] = [
    {
      id: "featured",
      name: "Gecko Genesis",
      category: "limited",
      categoryLabel: "Limited Drop",
      price: 2.5,
      supplyLeft: 4120,
      totalSupply: 5000,
      oddsPreview: {},
      image: "",
      description: "",
    },
  ];
  const pack = packs[0];

  return (
    <motion.div
      className="relative w-[220px] rounded-[20px] overflow-hidden cursor-pointer"
      whileHover={{ scale: 1.055, rotateY: 10 }}
      transition={{ type: "spring", stiffness: 300, damping: 18 }}
      style={{ transformStyle: "preserve-3d" }}
      onClick={() => onOpen(pack.name)}
    >
      {/* Back glow */}
      <div className="absolute -inset-10 rounded-[36px] bg-gradient-to-br from-[#39ff14] to-emerald-500 opacity-40 blur-3xl -z-10" />

      <div className="relative w-full aspect-[140/190] rounded-[20px] overflow-hidden border border-[#39ff14]/25 shadow-[0_0_36px_rgba(57,255,20,0.28)]">

        {/* Grid background */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(rgba(57,255,20,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(57,255,20,0.15) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/10" />

        {/* Scanlines */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)",
          }}
        />

        {/* Solana emblem */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[#39ff14]/15 to-emerald-500/10 border border-[#39ff14]/25 flex items-center justify-center">
            <LuSwords className="text-[#39ff14] text-3xl" />
          </div>
        </div>

        {/* Bottom info */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <p className="text-[9px] uppercase tracking-[0.18em] text-[#39ff14]/60 mb-0.5">
            Featured · Limited Drop
          </p>
          <p className="text-sm font-bold text-white">{pack.name}</p>
          <div className="flex items-center justify-between mt-2">
            <span className="text-base font-extrabold text-[#39ff14]">{pack.price} SOL</span>
            <span className="text-[10px] text-gray-500">+{pack.supplyLeft.toLocaleString()} left</span>
          </div>

          {/* CTA */}
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className="mt-3 w-full rounded-xl bg-[#39ff14] text-black font-bold text-xs py-2.5 hover:shadow-[0_0_20px_rgba(57,255,20,0.55)] transition-shadow"
            onClick={(e) => { e.stopPropagation(); onOpen(pack.name); }}
          >
            ✦ Open Pack
          </motion.button>
        </div>

        {/* Bottom glow stripe */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#39ff14]/60 to-transparent" />
      </div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════
   Particle field canvas
══════════════════════════════════════════ */
function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * (window.devicePixelRatio || 1);
      canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1);
      ctx?.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    };
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: 70 }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight,
      r: Math.random() * 1.8 + 0.4,
      dx: (Math.random() - 0.5) * 0.25,
      dy: (Math.random() - 0.5) * 0.25,
      alpha: Math.random() * 0.6 + 0.1,
    }));

    let raf = 0;
    function draw() {
      const W = canvas!.offsetWidth;
      const H = canvas!.offsetHeight;
      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = "#39ff14";
      for (const p of particles) {
        p.x += p.dx; p.y += p.dy;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
        ctx!.globalAlpha = p.alpha;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}
