"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  FiStar, FiBox, FiChevronDown,
} from "react-icons/fi";
import { LuSwords, LuSparkles } from "react-icons/lu";
import type { PackItem } from "@/lib/mockData";
import { NETWORK } from "@/lib/env";
import { resolveIpfsUrl } from "@/lib/helpers";

interface TickerItem {
  text: string;
  sig?: string;
}

/* ══════════════════════════════════════════
   Ticker — infinite scrolling wins
══════════════════════════════════════════ */
function Ticker({ items }: { items: TickerItem[] }) {
  const doubled = [...items, ...items];
  const isMainnet = NETWORK.toLowerCase().includes("mainnet");
  const clusterParam = isMainnet ? "" : "?cluster=devnet";

  return (
    <div className="overflow-hidden">
      <div className="ticker-anim flex gap-10 whitespace-nowrap text-sm text-[#2d5a3f]">
        {doubled.map((t, i) => {
          const content = (
            <span className="flex items-center gap-2">
              <FiStar className="text-[#1cac64] text-xs shrink-0" />
              {t.text}
            </span>
          );

          if (t.sig) {
            return (
              <a
                key={i}
                href={`https://solscan.io/tx/${t.sig}${clusterParam}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline hover:text-[#1cac64] transition-colors cursor-pointer"
                title="Verify transaction on Solscan"
              >
                {content}
              </a>
            );
          }

          return <span key={i}>{content}</span>;
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   HERO — Vertical layout
══════════════════════════════════════════ */
export default function Hero({
  onOpenPack,
  liveBoxes = [],
}: {
  onOpenPack: (packName: string) => void;
  liveBoxes?: any[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [liveWins, setLiveWins] = useState<TickerItem[]>([]);

  useEffect(() => {
    async function fetchWins() {
      try {
        const res = await fetch("/api/leaderboard");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const sorted = data.sort((a, b) => b.timestamp - a.timestamp);
            const formatted: TickerItem[] = sorted.map((record: any) => {
              const userShort = record.user ? `${record.user.slice(0, 4)}...${record.user.slice(-4)}` : "User";
              const text = record.isSolBox 
                ? `${userShort} won SOL in /${record.slug}!` 
                : `${userShort} opened a box in /${record.slug}!`;
              return {
                text,
                sig: record.sig
              };
            });
            setLiveWins(formatted);
          }
        }
      } catch (err) {
        console.error("Failed to fetch leaderboard wins in Hero:", err);
      }
    }
    fetchWins();
    
    const interval = setInterval(fetchWins, 10000);
    return () => clearInterval(interval);
  }, []);

  const fallbackWins: TickerItem[] = [
    { text: "0xWizard won a Mythic Diamond Ape" },
    { text: "GeckoGuru won a Legendary Geckura #0842" },
    { text: "NeonFiona won an Epic Toxic Reptile" },
    { text: "LunaStack won a Rare Neon Claw" },
    { text: "ByteBaron won a Mythic Sacred Hex" },
    { text: "MoonKid won a Legendary Plasma Spine" },
  ];

  const winsToDisplay = liveWins.length > 0 ? [...liveWins, ...fallbackWins] : fallbackWins;

  return (
    <section
      ref={containerRef}
      className="relative overflow-hidden rounded-3xl border border-[#1cac64]/15"
    >
      {/* ── Animated gradient background ── */}
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#e0f8d5_0%,#ebfde3_30%,#d9f5cc_60%,#c8edba_100%)]" />

      {/* ── Floating gradient orbs ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-20 -right-20 w-[400px] h-[400px] rounded-full bg-[#1cac64]/8 blur-[100px]"
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-32 -left-20 w-[350px] h-[350px] rounded-full bg-emerald-400/10 blur-[80px]"
          animate={{ x: [0, -25, 0], y: [0, 20, 0] }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full bg-[#22c55e]/6 blur-[90px]"
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* ── Background particle field ── */}
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <ParticleField />
      </div>

      {/* ── Decorative grid pattern ── */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(28,172,100,1) 1px, transparent 1px), linear-gradient(90deg, rgba(28,172,100,1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* ── Live badge ── */}
      <div className="pointer-events-none absolute top-6 left-6 z-10">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] font-semibold text-[#1cac64]/80">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1cac64] opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1cac64]" />
          </span>
          Live Now
        </span>
      </div>

      {/* ── Floating decorative icons ── */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <motion.div
          className="absolute top-12 right-16 text-[#1cac64]/10 text-4xl"
          animate={{ y: [0, -12, 0], rotate: [0, 10, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <LuSparkles />
        </motion.div>
        <motion.div
          className="absolute bottom-20 left-12 text-[#1cac64]/10 text-3xl"
          animate={{ y: [0, 8, 0], rotate: [0, -8, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        >
          <FiBox />
        </motion.div>
        <motion.div
          className="absolute top-1/3 right-[10%] text-[#1cac64]/8 text-5xl"
          animate={{ y: [0, -8, 0], x: [0, 5, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        >
          <LuSwords />
        </motion.div>
      </div>

      {/* ── Main vertical content ── */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 sm:px-10 pt-16 pb-10 gap-10">

        {/* ── Headline section ── */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="max-w-2xl"
        >
          <h1 className="text-4xl sm:text-5xl lg:text-[60px] font-black leading-[1.05] tracking-tight">
            <span className="text-[#1a3a2a]">Premium </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#1cac64] via-emerald-500 to-[#22c55e]">
              Geckura Mystery
            </span>
            <br />
            <span className="text-[#1a3a2a]">Boxes</span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-[#3d6b4e] max-w-lg mx-auto leading-relaxed">
            Unlock rare NFT collectibles from Solana&apos;s most exciting mystery drop ecosystem — real-time odds, provably fair, instant settlements.
          </p>

          {/* ── CTA Button ── */}
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onOpenPack("Gecko Genesis")}
            className="mt-7 inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl bg-[#1cac64] text-white font-bold text-sm
              shadow-[0_4px_24px_rgba(28,172,100,0.3)] hover:shadow-[0_4px_40px_rgba(28,172,100,0.45)]
              transition-all cursor-pointer"
          >
            <LuSparkles className="text-lg" />
            Explore Packs
            <FiChevronDown className="text-sm -rotate-90" />
          </motion.button>
        </motion.div>

        {/* ── Featured pack card — centered ── */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.85, delay: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative"
        >
          {/* Ambient glow behind pack */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-80 h-80 rounded-full opacity-35 blur-[90px] bg-[#1cac64]/25" />
            <div className="absolute w-52 h-52 rounded-full opacity-25 blur-[60px] bg-emerald-400/30" />
          </div>

          {/* Featured pack card */}
          <div className="relative float-anim">
            <FeaturedPack liveBox={liveBoxes[0] || null} onOpen={onOpenPack} />
          </div>
        </motion.div>

        {/* ── Ticker bar ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="w-full max-w-3xl mx-auto rounded-2xl bg-white/40 backdrop-blur-md border border-[#1cac64]/10 px-4 py-3"
        >
          <Ticker items={winsToDisplay} />
        </motion.div>

        {/* ── Scroll hint ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="flex flex-col items-center gap-1.5 text-[#6b9b7a]"
        >
          <span className="text-[10px] uppercase tracking-[0.2em]">Scroll to explore</span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="text-xs"
          >
            <FiChevronDown />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════
   Featured (hero) mini pack — enhanced
══════════════════════════════════════════ */
function FeaturedPack({ liveBox, onOpen }: { liveBox: any; onOpen: (n: string) => void }) {
  const packName = liveBox?.name || "Gecko Genesis";
  const packPrice = liveBox ? (Number(liveBox.priceLamports) / 1e9) : 2.5;
  const supplyLeft = liveBox ? (Number(liveBox.supply) - Number(liveBox.sold)) : 4120;
  const totalSupply = liveBox ? Number(liveBox.supply) : 5000;
  const bannerUrl = liveBox?.bannerUri ? resolveIpfsUrl(liveBox.bannerUri) : null;
  const soldPercent = Math.round(((totalSupply - supplyLeft) / totalSupply) * 100);

  return (
    <motion.div
      className="relative w-[240px] rounded-[24px] overflow-hidden cursor-pointer"
      whileHover={{ scale: 1.06, rotateY: 8, rotateX: -3 }}
      transition={{ type: "spring", stiffness: 300, damping: 18 }}
      style={{ transformStyle: "preserve-3d" }}
      onClick={() => onOpen(packName)}
    >
      {/* Back glow */}
      <div className="absolute -inset-12 rounded-[40px] bg-gradient-to-br from-[#1cac64] to-emerald-400 opacity-35 blur-3xl -z-10" />

      <div className="relative w-full aspect-[140/200] rounded-[24px] overflow-hidden border-2 border-[#1cac64]/30 shadow-[0_0_48px_rgba(28,172,100,0.2),0_8px_32px_rgba(0,0,0,0.1)]">

        {/* Background Banner / Grid */}
        {bannerUrl ? (
          <img src={bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div
            className="absolute inset-0 opacity-15"
            style={{
              backgroundImage:
                "linear-gradient(rgba(28,172,100,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(28,172,100,0.15) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
            }}
          />
        )}

        {/* Gradient overlay - bottom heavy for text contrast */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a2e1a]/95 via-[#0a2e1a]/40 to-transparent" />

        {/* Scanlines */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.4) 2px, rgba(255,255,255,0.4) 3px)",
          }}
        />

        {/* Corner accents */}
        <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-[#1cac64]/40 rounded-tl-lg" />
        <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-[#1cac64]/40 rounded-tr-lg" />

        {/* Bottom info panel */}
        <div className="absolute bottom-0 left-0 right-0 p-5">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[#1cac64]/70 mb-1 flex items-center gap-1.5">
            <LuSparkles className="text-[10px]" />
            Featured · Limited Drop
          </p>
          <p className="text-base font-bold text-white">{packName}</p>

          {/* Supply bar */}
          <div className="mt-2.5 w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#1cac64] to-emerald-400"
              initial={{ width: 0 }}
              animate={{ width: `${soldPercent}%` }}
              transition={{ duration: 1.2, delay: 0.5, ease: "easeOut" }}
            />
          </div>

          <div className="flex items-center justify-between mt-2">
            <span className="text-lg font-extrabold text-[#1cac64]">{packPrice} SOL</span>
            <span className="text-[10px] text-white/60">{supplyLeft.toLocaleString()} left</span>
          </div>

          {/* CTA */}
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.97 }}
            className="mt-3 w-full rounded-xl bg-[#1cac64] text-white font-bold text-xs py-3
              shadow-[0_0_20px_rgba(28,172,100,0.35)] hover:shadow-[0_0_30px_rgba(28,172,100,0.5)] transition-shadow"
            onClick={(e) => { e.stopPropagation(); onOpen(packName); }}
          >
            ✦ Open Pack
          </motion.button>
        </div>

        {/* Bottom glow stripe */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#1cac64]/60 to-transparent" />
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

    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight,
      r: Math.random() * 2 + 0.3,
      dx: (Math.random() - 0.5) * 0.2,
      dy: (Math.random() - 0.5) * 0.2,
      alpha: Math.random() * 0.5 + 0.1,
    }));

    let raf = 0;
    function draw() {
      const W = canvas!.offsetWidth;
      const H = canvas!.offsetHeight;
      ctx!.clearRect(0, 0, W, H);
      ctx!.fillStyle = "#1cac64";
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
