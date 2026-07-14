"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { FiAward, FiClock, FiShield, FiTrendingUp, FiUser, FiActivity } from "react-icons/fi";
import Link from "next/link";
import { retryWithBackoff, fetchProjects, PROGRAM_ID as PGID } from "@/lib/program-ix";
import IDL from "@/lib/idl.json";
import { resolveIpfsUrl, updateFavicon } from "@/lib/helpers";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { useSetProjectBranding } from "@/lib/ProjectBrandingProvider";

const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

interface ParsedEvent {
  sig: string;
  user: string;
  boxConfig: string;
  timestamp: number;
  isSolBox: boolean;
  username?: string;
  avatar?: string;
}

interface LeaderboardUser {
  wallet: string;
  username: string;
  avatar: string;
  points: number;
  opens: number;
  rank?: number;
}

const leaderboardCache: Record<string, { events: ParsedEvent[]; timestamp: number }> = {};

export default function ProjectLeaderboardPage() {
  const wallet = useWallet();
  const params = useParams();
  const slug = (params?.slug as string) || "geckurabox";
  const setBranding = useSetProjectBranding();

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"weekly" | "monthly">("weekly");
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [projectTitle, setProjectTitle] = useState("");
  const [solRankingPoints, setSolRankingPoints] = useState(2);
  const [tokenRankingPoints, setTokenRankingPoints] = useState(1);
  const [progressMsg, setProgressMsg] = useState("Fetching project activity...");
  const [bgUri, setBgUri] = useState("");
  const [nftAvatars, setNftAvatars] = useState<Record<string, string>>({});
  const fetchedWallets = useRef<Set<string>>(new Set());

  const getAvatar = (pubkey: string) => {
    let sum = 0;
    for (let i = 0; i < pubkey.length; i++) {
      sum += pubkey.charCodeAt(i);
    }
    const index = sum % 6;
    
    // Curated premium collectible placeholders (themed as Geckura RPG collectibles with gradient backgrounds)
    const premiumFallbacks = [
      `https://api.dicebear.com/7.x/adventurer/svg?seed=GekHero-${sum % 100}&backgroundColor=b6e3f4,c0aede,d1d4f9`,
      `https://api.dicebear.com/7.x/adventurer/svg?seed=GekSage-${(sum + 17) % 100}&backgroundColor=b6e3f4,c0aede,d1d4f9`,
      `https://api.dicebear.com/7.x/adventurer/svg?seed=GekRogue-${(sum + 31) % 100}&backgroundColor=b6e3f4,c0aede,d1d4f9`,
      `https://api.dicebear.com/7.x/adventurer/svg?seed=GekMage-${(sum + 59) % 100}&backgroundColor=b6e3f4,c0aede,d1d4f9`,
      `https://api.dicebear.com/7.x/adventurer/svg?seed=GekKnight-${(sum + 73) % 100}&backgroundColor=b6e3f4,c0aede,d1d4f9`,
      `https://api.dicebear.com/7.x/adventurer/svg?seed=GekAlchemist-${(sum + 89) % 100}&backgroundColor=b6e3f4,c0aede,d1d4f9`,
    ];
    return premiumFallbacks[index];
  };

  const getUsername = (pubkey: string) => {
    return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
  };



  // Check branding from localStorage immediately on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const localBranding = localStorage.getItem(`project_branding_${slug}`);
      if (localBranding) {
        try {
          const parsed = JSON.parse(localBranding);
          const nameVal = parsed.name || slug;
          const bgVal = parsed.bgUri || "";
          const logoVal = parsed.logoUri || "";
          const themeVal = parsed.themeColor || "";

          if (parsed.name) setProjectTitle(parsed.name);
          if (parsed.bgUri) setBgUri(parsed.bgUri);
          
          updateFavicon(logoVal, parsed.navbarColor || null);
          setBranding({
            name: nameVal,
            logoUrl: resolveIpfsUrl(logoVal) || null,
            themeColor: themeVal || null,
            navbarColor: parsed.navbarColor || null,
            textColor: parsed.textColor || null,
            nothingRewardImage: parsed.nothingRewardImage || null,
            twitterUsername: parsed.twitterUsername || null,
            twitterLink: parsed.twitterLink || null,
          });
          document.title = `${nameVal} | Leaderboard`;
        } catch {}
      }
    }
  }, [slug, setBranding]);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        // 1. Fetch database leaderboard first (zero delay!)
        setProgressMsg("Loading rankings from database...");
        let allEvents: ParsedEvent[] = [];
        
        const cached = leaderboardCache[slug];
        const now = Date.now();
        if (cached && now - cached.timestamp < 10000) { // 10s memory cache
          allEvents = cached.events;
        } else {
          try {
            const res = await fetch(`/api/leaderboard?slug=${slug}`);
            if (res.ok) {
              allEvents = await res.json();
              leaderboardCache[slug] = {
                events: allEvents,
                timestamp: Date.now()
              };
            }
          } catch (err) {
            console.error("Failed to fetch off-chain leaderboard:", err);
          }
        }

        if (active) {
          setEvents(allEvents.sort((a, b) => b.timestamp - a.timestamp));
        }

        // 2. Fetch project branding & custom point rules in background
        const conn = new Connection(RPC, "confirmed");
        const [projectPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("project"), Buffer.from(slug)], PGID
        );

        try {
          const projectAcc = await conn.getAccountInfo(projectPDA);
          if (projectAcc && active) {
            const proj: any = new BorshAccountsCoder(IDL as any).decode("Project", projectAcc.data);
            
            let nameVal = proj?.name || slug;
            let bgVal = "";
            let logoVal = proj?.logoUri || "";
            let themeVal = proj?.themeColor || "";
            let navColor = "";
            let txtColor = "";
            let twLink = "";
            let twUser = "";
            
            if (typeof window !== "undefined") {
              const localBranding = localStorage.getItem(`project_branding_${slug}`);
              if (localBranding) {
                try {
                  const parsed = JSON.parse(localBranding);
                  nameVal = parsed.name || nameVal;
                  bgVal = parsed.bgUri || "";
                  logoVal = parsed.logoUri || logoVal;
                  themeVal = parsed.themeColor || themeVal;
                  navColor = parsed.navbarColor || "";
                  txtColor = parsed.textColor || "";
                  twLink = parsed.twitterLink || "";
                  twUser = parsed.twitterUsername || "";
                } catch {}
              }
            }
            setProjectTitle(nameVal);
            setSolRankingPoints(proj?.solRankingPoints || 2);
            setTokenRankingPoints(proj?.tokenRankingPoints || 1);
            if (bgVal) setBgUri(bgVal);
            updateFavicon(logoVal, navColor || null);
            setBranding({
              name: nameVal,
              logoUrl: resolveIpfsUrl(logoVal) || null,
              themeColor: themeVal || null,
              navbarColor: navColor || null,
              textColor: txtColor || null,
              nothingRewardImage: proj?.nothingRewardImage || null,
              twitterUsername: twUser || null,
              twitterLink: twLink || null,
            });
            document.title = `${nameVal} | Leaderboard`;
          }
        } catch (e) {
          console.warn("Failed to fetch project details in background:", e);
        }
      } catch (err) {
        console.error("Leaderboard loading failed:", err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [slug]);

  // Compute point rankings (Weekly: 7 days, Monthly: 30 days)
  const rankings = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const secondsInPeriod = activeTab === "weekly" ? 7 * 86400 : 30 * 86400;
    const periodStart = now - secondsInPeriod;

    const userMap = new Map<string, { points: number; opens: number; username?: string; avatar?: string }>();

    for (const ev of events) {
      if (ev.timestamp >= periodStart) {
        const pointsAwarded = ev.isSolBox ? solRankingPoints : tokenRankingPoints;
        const current = userMap.get(ev.user) || { points: 0, opens: 0, username: ev.username || undefined, avatar: ev.avatar || undefined };
        userMap.set(ev.user, {
          points: current.points + pointsAwarded,
          opens: current.opens + 1,
          username: ev.username || current.username,
          avatar: ev.avatar || current.avatar,
        });
      }
    }

    const sorted: LeaderboardUser[] = Array.from(userMap.entries()).map(([wallet, stats]) => ({
      wallet,
      username: stats.username || getUsername(wallet),
      avatar: stats.avatar || getAvatar(wallet),
      points: stats.points,
      opens: stats.opens,
    })).sort((a, b) => b.points - a.points);

    sorted.forEach((item, index) => {
      item.rank = index + 1;
    });

    return sorted;
  }, [events, activeTab, solRankingPoints, tokenRankingPoints]);

  const displayedRankings = useMemo(() => {
    return rankings.slice(3, 10);
  }, [rankings]);

  const topThree = useMemo(() => {
    const list = rankings.slice(0, 3);
    return [list[1], list[0], list[2]].filter(Boolean);
  }, [rankings]);

  const stats = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const secondsInPeriod = activeTab === "weekly" ? 7 * 86400 : 30 * 86400;
    const periodStart = now - secondsInPeriod;

    const activeEvents = events.filter(e => e.timestamp >= periodStart);
    const totalOpens = activeEvents.length;
    const totalPoints = activeEvents.reduce((s, e) => s + (e.isSolBox ? solRankingPoints : tokenRankingPoints), 0);
    const totalParticipants = new Set(activeEvents.map(e => e.user)).size;

    return { totalOpens, totalPoints, totalParticipants };
  }, [events, activeTab, solRankingPoints, tokenRankingPoints]);

  const homeHref = slug === "geckurabox" ? "/" : `/${slug}`;

  const resolvedBgUri = resolveIpfsUrl(bgUri);

  return (
    <div 
      className="min-h-screen text-[#1a3a2a] flex flex-col"
      style={resolvedBgUri ? {
        backgroundImage: `radial-gradient(circle at top, rgba(10, 10, 10, 0.4) 0%, rgba(10, 10, 10, 0.85) 100%), url('${resolvedBgUri}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      } : {
        backgroundColor: '#ebfde3'
      }}
    >
      <div className="flex-grow pb-12">
        {/* Hero header */}
      <div className={`relative overflow-hidden py-16 ${resolvedBgUri ? "bg-transparent" : "bg-gradient-to-b from-[#d9f5cc] via-[#e0f8d5]/80 to-[#ebfde3] border-b border-[#1cac64]/8"}`}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(28,172,100,0.06),transparent_60%)] pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-5 text-center space-y-4">
          <h1 className="text-4xl sm:text-5xl font-black text-[#0f2618] tracking-tight leading-tight" style={resolvedBgUri ? { textShadow: "0 2px 10px rgba(0,0,0,0.95)" } : {}}>
            {projectTitle} <span className="text-[#1cac64] drop-shadow-[0_0_20px_rgba(28,172,100,0.25)]">Leaderboard</span>
          </h1>
          <p className="text-sm text-[#1a3a2a] max-w-lg mx-auto leading-relaxed" style={resolvedBgUri ? { textShadow: "0 1px 6px rgba(0,0,0,0.95)" } : {}}>
            Rankings for {projectTitle}. Solana box openings earn <span className="text-[#1cac64] font-semibold">{solRankingPoints} {solRankingPoints === 1 ? "point" : "points"}</span>, and token openings earn <span className="text-[#1cac64] font-semibold">{tokenRankingPoints} {tokenRankingPoints === 1 ? "point" : "points"}</span>.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 mt-10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="h-8 w-8 border-2 border-[#1cac64] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-[#3d6b4e] uppercase tracking-widest">{progressMsg}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Control bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-2 bg-[#111]/60 border border-[#1cac64]/10 rounded-2xl backdrop-blur-xl">
              {/* Weekly / Monthly tabs */}
              <div className="grid grid-cols-2 gap-1 w-full sm:w-auto sm:mx-auto">
                <button
                  onClick={() => setActiveTab("weekly")}
                  className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === "weekly"
                      ? "bg-[#1cac64] text-black shadow-[0_0_20px_rgba(28,172,100,0.3)]"
                      : "text-[#2d5a3f] hover:text-[#0f2618]"
                  }`}
                >
                  <FiClock className="text-sm" /> Weekly
                </button>
                <button
                  onClick={() => setActiveTab("monthly")}
                  className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === "monthly"
                      ? "bg-[#1cac64] text-black shadow-[0_0_20px_rgba(28,172,100,0.3)]"
                      : "text-[#2d5a3f] hover:text-[#0f2618]"
                  }`}
                >
                  <FiAward className="text-sm" /> Monthly
                </button>
              </div>
            </div>

            {/* Podium for top 3 */}
            {rankings.length > 0 && (
              <div className="grid grid-cols-3 gap-3 items-end max-w-2xl mx-auto pt-10 pb-6">
                {topThree.map((user) => {
                  const isGold = user.rank === 1;
                  const isSilver = user.rank === 2;
                  const heightClass = isGold ? "h-64 sm:h-72" : isSilver ? "h-48 sm:h-56" : "h-36 sm:h-44";
                  const rankColor = isGold ? "border-amber-400 text-amber-400" : isSilver ? "border-gray-300 text-[#1a3a2a]" : "border-amber-600 text-amber-600";
                  const shadowColor = isGold ? "shadow-[0_0_40px_rgba(245,158,11,0.15)]" : isSilver ? "shadow-[0_0_30px_rgba(209,213,219,0.08)]" : "shadow-[0_0_20px_rgba(180,83,9,0.06)]";

                  return (
                    <motion.div
                      key={user.wallet}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex flex-col items-center justify-end rounded-t-3xl border border-[#1cac64]/10 bg-gradient-to-b from-white/[0.03] to-[#111] p-4 text-center ${heightClass} ${shadowColor}`}
                    >
                      {/* Avatar */}
                      <div className="relative group">
                        <img
                          src={user.avatar}
                          alt={user.username}
                          className="h-12 w-12 sm:h-16 sm:w-16 rounded-full border-2 border-[#1cac64]/12 bg-[#ebfde3] group-hover:scale-105 transition-transform"
                        />
                        <span className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border bg-black text-[10px] font-black flex items-center justify-center ${rankColor}`}>
                          {user.rank}
                        </span>
                      </div>

                      {/* Name */}
                      <p className="text-xs font-black text-[#0f2618] mt-4 truncate max-w-full">
                        {user.username}
                      </p>
                      <p className="text-[10px] text-[#3d6b4e] font-mono mt-0.5 truncate max-w-full">
                        {user.wallet.slice(0, 8)}…
                      </p>

                      {/* Score */}
                      <div className="mt-4 bg-black/60 rounded-xl py-1.5 px-3 border border-[#1cac64]/10 w-full">
                        <p className="text-[10px] text-[#3d6b4e] uppercase tracking-widest leading-none">Points</p>
                        <p className="text-sm font-black text-[#1cac64] mt-1">{user.points}</p>
                        <p className="text-[9px] text-[#3d6b4e] mt-0.5 font-semibold">{user.opens} opens</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Rankings list / table */}
            {displayedRankings.length === 0 ? (
              <div className="py-20 text-center glass-panel rounded-3xl">
                <span className="text-4xl">🏆</span>
                <p className="text-[#2d5a3f] text-sm mt-3">No activity logged for {projectTitle} yet.</p>
                <p className="text-[#4a7d5e] text-xs mt-1">Open packs from this storefront to climb the leaderboard!</p>
              </div>
            ) : (
              <div className="glass-panel rounded-2xl overflow-hidden border border-[#1cac64]/10">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#1cac64]/10 bg-[#1cac64]/3">
                        <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-[#3d6b4e]">Rank</th>
                        <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-[#3d6b4e]">Opener</th>
                        <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-[#3d6b4e]">Total Opens</th>
                        <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-[#3d6b4e] text-right">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRankings.map((user, idx) => {
                        const isTopThree = (user.rank || 0) <= 3;
                        const rankColor =
                          user.rank === 1 ? "text-amber-400" :
                          user.rank === 2 ? "text-[#1a3a2a]" :
                          user.rank === 3 ? "text-amber-600" : "text-[#2d5a3f]";

                        const isCurrentUser = wallet.publicKey && wallet.publicKey.toBase58() === user.wallet;

                        return (
                          <motion.tr
                            key={user.wallet}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.03 }}
                            className={`border-b border-[#1cac64]/8 last:border-none hover:bg-[#1cac64]/3 transition-colors ${
                              isCurrentUser ? "bg-[#1cac64]/[0.03] border-l-2 border-l-[#1cac64]" : ""
                            }`}
                          >
                            {/* Rank */}
                            <td className="py-4 px-5">
                              <span className={`text-sm font-black ${rankColor}`}>
                                #{user.rank}
                              </span>
                            </td>

                            {/* User details */}
                            <td className="py-4 px-5">
                              <div className="flex items-center gap-3">
                                <img
                                  src={user.avatar}
                                  alt={user.username}
                                  className="h-8 w-8 rounded-full bg-[#111] border border-[#1cac64]/12"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-[#0f2618] hover:text-[#1cac64] cursor-pointer">
                                      {user.username}
                                    </span>
                                    {isCurrentUser && (
                                      <span className="text-[8px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-[#1cac64]/20 text-[#1cac64] border border-[#1cac64]/30 font-black">
                                        You
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-[#3d6b4e] font-mono mt-0.5 truncate max-w-[150px] sm:max-w-xs" title={user.wallet}>
                                    {user.wallet}
                                  </p>
                                </div>
                              </div>
                            </td>

                            {/* Total Opens */}
                            <td className="py-4 px-5">
                              <div className="flex items-center gap-1.5 text-xs text-[#1a3a2a] font-semibold">
                                <FiActivity className="text-[#3d6b4e] text-sm" />
                                {user.opens}
                              </div>
                            </td>

                            {/* Points */}
                            <td className="py-4 px-5 text-right">
                              <div className="flex items-center justify-end gap-1 font-mono font-bold text-[#1cac64]">
                                <FiTrendingUp className="text-xs animate-bounce" />
                                <span className="text-sm">{user.points}</span>
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer hint */}
                {rankings.length > 3 && (
                  <div className="p-4 bg-[#1cac64]/3 text-center border-t border-[#1cac64]/8">
                    <p className="text-[11px] text-[#3d6b4e]">
                      Showing ranks 4-10. Top 3 are displayed in the podium above.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-[#1cac64]/10 mt-auto bg-[#ffffff]/40 backdrop-blur-md">
        <div className="mx-auto max-w-5xl px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-black">
              <span className="text-[#1cac64]">Geck</span><span className="text-[#0f2618]/50">ura</span>
            </span>
            <span className="text-xs text-[#3d6b4e]">© 2026 Geckura. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-[#2d5a3f]">
            <span>
              Made with <span className="text-red-500 animate-pulse">❤️</span> by{" "}
              <a 
                href="https://x.com/geckura" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-[#1cac64] hover:text-[#0f2618] font-semibold transition-colors"
              >
                Geckura
              </a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
