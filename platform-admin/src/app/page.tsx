"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import PackGrid from "@/components/PackGrid";
import DailyRewards from "@/components/DailyRewards";
import PackOpening from "@/components/PackOpening";
import { useAppStore, type LiveBox } from "@/lib/store";
import type { PackItem } from "@/lib/mockData";
import toast from "react-hot-toast";
import { Connection } from "@solana/web3.js";

/* ─────────────────────────────────────────────────────────────────
   Map LiveBox (on-chain) → PackItem (UI shape)
───────────────────────────────────────────────────────────────── */
function boxToPack(box: LiveBox): PackItem {
  const priceSol = box.priceLamports / 1e9;
  const supplyLeft = Math.max(0, (box.supply || 0) - (box.sold || 0));
  const cat = priceSol >= 10 ? "legendary_vault"
            : priceSol >= 3  ? "limited"
            : priceSol >= 1  ? "seasonal"
            : "community";
  return {
    id: box.pubkey,
    name: box.name || `Box #${box.boxId}`,
    category: cat,
    categoryLabel: ["Limited Drop", "Community Pack", "Seasonal Pack", "Legendary Vault"][
      cat === "legendary_vault" ? 3 : cat === "limited" ? 0 : cat === "seasonal" ? 2 : 1
    ],
    price: parseFloat((box.priceLamports / 1e9).toFixed(4)),
    supplyLeft,
    totalSupply: box.supply || 0,
    oddsPreview: {},
    image: box.bannerUri || "",
    description: box.description || "Mystery box from the Geckura ecosystem.",
  };
}

const LEADERS = [
  { rank: 1, username: "DegenDave",   value: 14320.0, avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=dave" },
  { rank: 2, username: "CryptoQueen", value: 9850.4,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=cqueen" },
  { rank: 3, username: "0xPhantom",   value: 7720.1,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=phantom" },
  { rank: 4, username: "GeckoGuru",   value: 5210.2,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=guru" },
  { rank: 5, username: "ByteBaron",   value: 4100.5,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=baron" },
  { rank: 6, username: "MoonKid",     value: 3480.9,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=moonkid" },
  { rank: 7, username: "LunaStack",   value: 2950.8,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=luna" },
  { rank: 8, username: "SolWhale99",  value: 2190.0,  avatar: "https://api.dicebear.com/7.x/pixel-art/svg?seed=whale" },
];

function StatMini({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">{label}</p>
      <p className={`text-base font-bold mt-0.5 ${accent || "text-white"}`}>{value}</p>
    </div>
  );
}

export default function HomePage() {
  const wallet           = useWallet();
  const { publicKey }    = wallet;
  const RPC              = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

  const {
    boxes, categoryFilter, setCategoryFilter,
    isOpening, openingBoxName, openBox, closeBoxPanel,
    claimReward,
    openBoxNow, refetch,
  } = useAppStore();

  const [solBalance, setSolBalance] = useState(0);

  /* Initialise from chain */
  useEffect(() => {
    refetch();
  }, [refetch]);

  /* Poll every 30 s */
  useEffect(() => {
    const id = setInterval(() => refetch(), 30_000);
    return () => clearInterval(id);
  }, [refetch]);

  /* Refresh balance when wallet changes */
   useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    (async () => {
      if (!publicKey) { setSolBalance(0); return; }
      try {
        const conn = new Connection(RPC, "confirmed");
        const lamports = await conn.getBalance(publicKey);
        setSolBalance(lamports / 1e9);
      } catch { /* ok */ }
    })();
  }, [publicKey, RPC]);

  /* Convert chain boxes → UI packs */
  const packs = useMemo(() => boxes.map(boxToPack), [boxes]);
  const filteredPacks = useMemo(
    () => (categoryFilter === "all" ? packs : packs.filter((p) => p.category === categoryFilter)),
    [packs, categoryFilter],
  );

  /* Open handler — show cinematic, then call on-chain open */
  const handleOpenBox = useCallback((packName: string) => {
    openBox(packName);
  }, [openBox]);

  /* Claim — call on-chain openBox RPC when play button pressed */
  const handleClaim = useCallback(async (_win: { name: string; rarity: string; image: string }) => {
    const liveBox = boxes.find(b => boxToPack(b).name === openingBoxName);
    if (!liveBox) { toast.error("Box data not ready."); return; }
    try {
      await openBoxNow(liveBox);
      claimReward();
      toast.success("Reward claimed!");
      refetch();
    } catch (e: any) { toast.error(e?.message || "Claim failed"); }
  }, [boxes, openingBoxName, openBoxNow, claimReward, refetch]);

  /* Simple Play → immediately call on-chain openBox */
  const handlePlayFromGrid = useCallback(async (packItem: PackItem) => {
    const liveBox = boxes.find(b => b.pubkey === packItem.id);
    if (!liveBox) { toast.error("Box not ready yet."); return; }
    // For big packs / vaults, show cinematic first; for cheap ones, just transact
    if (packItem.price >= 1 || liveBox.sold < 1) {
      openBox(packItem.name); // cinematic
      return;
    }
    // Low-price: direct open
    try {
      toast.loading("Opening box…", { id: `open-${liveBox.boxId}` });
      await openBoxNow(liveBox);
      toast.success("Opened!", { id: `open-${liveBox.boxId}` });
      refetch();
    } catch (e: any) { toast.error(e?.message || "Open failed", { id: `open-${liveBox.boxId}` }); }
  }, [boxes, openBox, openBoxNow, refetch]);

  const totalSold = boxes.reduce((a, b) => a + (b.sold || 0), 0);
  const activeBoxes = boxes.filter(b => b.status === 0).length;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Navbar />

      <div className="mx-auto max-w-[1440px] px-4 lg:px-6 py-6 lg:py-8 space-y-8 lg:space-y-12">

        {/* ── HERO ── */}
        <Hero onOpenPack={handleOpenBox} />

        {/* ── LIVE TICKER — from chain ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-panel rounded-2xl px-5 py-3 overflow-hidden border border-white/[0.06]"
        >
          <div className="ticker-anim flex gap-8 whitespace-nowrap text-xs text-gray-400">
            {boxes.length === 0
              ? "Initialising Geckura chain data…".split("").map((ch, i) => (
                  <span key={i} className="text-[10px] text-gray-600">{ch === " " ? "\u00a0" : "·"}</span>
                ))
              : [...boxes, ...boxes].map((b, i) => (
                  <span key={i} className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] rounded-full bg-[#39ff14]/20 text-[#39ff14] py-0.5 px-1.5 font-bold">LIVE</span>
                    {b.name || `Box #${b.boxId}`} — {b.sold || 0} / {b.supply} sold
                  </span>
                ))
            }
          </div>
        </motion.div>

        {/* ── PACKS + SIDEBAR ── */}
        <section className="grid lg:grid-cols-[1fr_340px] gap-6 lg:gap-8">
          {/* Left — Pack Grid from chain */}
          <div className="space-y-5">
            <PackGrid
              packs={filteredPacks}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              onOpenPack={(name: string) => {
                const b = boxes.find(box => boxToPack(box).name === name);
                if (!b) { toast.error("Box not ready."); return; }
                handlePlayFromGrid(boxToPack(b));
              }}
            />
          </div>

          {/* Right — sidebar widgets */}
          <div className="space-y-5 lg:pt-12">
            <div className="glass-panel rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-base font-black">
                  <span className="text-[#39ff14]">Geck</span><span className="text-white/50">ura</span>
                </span>
                {publicKey && (
                  <span className="text-[10px] font-semibold text-[#39ff14]/60 tracking-wider uppercase">
                    {publicKey.toBase58().slice(0, 6)}…{publicKey.toBase58().slice(-4)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <StatMini label="Your Balance" value={`${solBalance.toFixed(3)} SOL`} accent="text-[#39ff14]" />
                <StatMini label="Total Sold" value={totalSold.toLocaleString()} />
                <StatMini label="Active Drops" value={activeBoxes} />
                <StatMini label="Your Wins" value="0" accent="text-gray-400" />
              </div>
            </div>

            <DailyRewards />
            <CountdownTimerLabel />
          </div>
        </section>

        {/* ── RECENT ACTIVITY ── */}
        <section className="space-y-4">
          <LiveDrawHistoryProxy boxes={boxes} />
        </section>
      </div>

      {/* ── PACK OPENING OVERLAY ── */}
      <PackOpening
        isOpen={isOpening}
        packName={openingBoxName}
        onClose={closeBoxPanel}
        onComplete={handleClaim}
      />

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.06] mt-12">
        <div className="mx-auto max-w-[1440px] px-4 lg:px-6 py-7 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-black">
              <span className="text-[#39ff14]">Geck</span><span className="text-white/50">ura</span>
            </span>
            <span className="text-xs text-gray-600">© 2026 Geckura</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#" className="text-xs text-gray-500 hover:text-[#39ff14] transition-colors">Docs</a>
            <a href="#" className="text-xs text-gray-500 hover:text-[#39ff14] transition-colors">Blog</a>
            <a href="#" className="text-xs text-gray-500 hover:text-[#39ff14] transition-colors">Twitter</a>
            <a href="#" className="text-xs text-gray-500 hover:text-[#39ff14] transition-colors">Discord</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────────────────────────── */

const LIMIT_DRAWS = [
  { id: "d1", username: "0xWizard",  avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=wizard",  packName: "Gecko Genesis", reward: "Common Gecko Scale",      rarity: "common"  as const, timestamp: Date.now() - 20_000 },
  { id: "d2", username: "GeckoGuru", avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=guru",   packName: "Cyber Hatch",   reward: "Rare Neon Claw",          rarity: "rare"    as const, timestamp: Date.now() - 60_000 },
  { id: "d3", username: "NeonFiona", avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=fiona",  packName: "Hex Box",       reward: "Epic Toxic Reptile",      rarity: "epic"    as const, timestamp: Date.now() - 100_000 },
  { id: "d4", username: "ByteBaron", avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=baron",  packName: "Vault Prime",   reward: "Mythic Diamond Ape",      rarity: "mythic"  as const, timestamp: Date.now() - 180_000 },
  { id: "d5", username: "LunaStack", avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=luna",  packName: "Phantom Drop",  reward: "Rare Chrome Scale",       rarity: "rare"    as const, timestamp: Date.now() - 240_000 },
  { id: "d6", username: "SolWhale99",avatarUrl: "https://api.dicebear.com/7.x/pixel-art/svg?seed=whale", packName: "Nano Crate",    reward: "Common Nano Bits",        rarity: "common"  as const, timestamp: Date.now() - 320_000 },
];

function LiveDrawHistoryProxy({ boxes }: { boxes: LiveBox[] }) {
  const draws = [...LIMIT_DRAWS];
  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-white/[0.06]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#39ff14] opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#39ff14]" />
          </span>
          <h3 className="text-sm font-bold text-white">Live Draw History</h3>
        </div>
      </div>

      {/* Box sold-to-date mini table / event list */}
      <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto">
        {boxes.slice(0, 6).map((b) => {
          const pct = b.supply > 0 ? Math.round((b.sold / b.supply) * 100) : 0;
          return (
            <div key={b.pubkey} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-none">
              <span className={`h-2 w-2 rounded-full shrink-0 ${b.status === 0 ? "bg-[#39ff14]" : "bg-gray-500"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-300 truncate">{b.name || `Box #${b.boxId}`}</p>
                  <p className="text-[11px] text-gray-600">{b.sold || 0} / {b.supply} purchased · {pct}%</p>

              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff14]/20 font-semibold">
                {pct}%
              </span>
            </div>
          );
        })}
        {boxes.length === 0 && (
          <p className="text-center text-xs text-gray-600 py-4">No box events yet — connect your wallet and check later.</p>
        )}
      </div>
    </div>
  );
}

function CountdownTimerLabel() {
  const [timeStr, setTimeStr] = useState("3:42:00");

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now() % 86400000;
      const remaining = 86400000 - now;
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setTimeStr(`${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#39ff14] opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#39ff14]" />
        </span>
        <h3 className="text-sm font-bold text-white">Next Drop</h3>
      </div>
      <p className="text-2xl font-black tabular-nums text-[#39ff14]">{timeStr}</p>
      <p className="text-[11px] text-gray-500">until next mystery release</p>
    </div>
  );
}
