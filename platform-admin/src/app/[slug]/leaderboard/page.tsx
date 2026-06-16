"use client";

import { useEffect, useState, useMemo } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { FiAward, FiClock, FiShield, FiTrendingUp, FiUser, FiActivity } from "react-icons/fi";
import Link from "next/link";
import { retryWithBackoff, fetchProjects, PROGRAM_ID as PGID } from "@/lib/program-ix";
import IDL from "@/lib/idl.json";
import { resolveIpfsUrl } from "@/lib/helpers";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import { useSetProjectBranding } from "@/lib/ProjectBrandingProvider";

const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

interface ParsedEvent {
  sig: string;
  user: string;
  boxConfig: string;
  timestamp: number;
  isSolBox: boolean;
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

  const getAvatar = (pubkey: string) => {
    return `https://api.dicebear.com/7.x/pixel-art/svg?seed=${pubkey.slice(0, 8)}`;
  };

  const getUsername = (pubkey: string) => {
    return `${pubkey.slice(0, 4)}…${pubkey.slice(-4)}`;
  };

  const updateFavicon = (logoVal: string) => {
    const resolvedLogo = resolveIpfsUrl(logoVal);
    if (resolvedLogo && typeof window !== "undefined") {
      let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement("link");
        link.rel = "shortcut icon";
        document.getElementsByTagName("head")[0].appendChild(link);
      }
      link.href = resolvedLogo;
    }
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
          
          updateFavicon(logoVal);
          setBranding({
            name: nameVal,
            logoUrl: resolveIpfsUrl(logoVal) || null,
            themeColor: themeVal || null,
            nothingRewardImage: parsed.nothingRewardImage || null,
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
        const conn = new Connection(RPC, "confirmed");

        // 1. Fetch project details
        setProgressMsg("Retrieving storefront details...");
        const [projectPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("project"), Buffer.from(slug)], PGID
        );

        try {
          const projectAcc = await retryWithBackoff(
            () => conn.getAccountInfo(projectPDA),
            "getAccountInfo(leaderboard_project)"
          );

          if (projectAcc && active) {
            const proj: any = new BorshAccountsCoder(IDL as any).decode("Project", projectAcc.data);
            
            let nameVal = proj?.name || slug;
            let bgVal = "";
            let logoVal = proj?.logoUri || "";
            let themeVal = proj?.themeColor || "";
            if (typeof window !== "undefined") {
              const localBranding = localStorage.getItem(`project_branding_${slug}`);
              if (localBranding) {
                try {
                  const parsed = JSON.parse(localBranding);
                  nameVal = parsed.name || nameVal;
                  bgVal = parsed.bgUri || "";
                  logoVal = parsed.logoUri || logoVal;
                  themeVal = parsed.themeColor || themeVal;
                } catch {}
              }
            }
            setProjectTitle(nameVal);
            setSolRankingPoints(proj?.solRankingPoints || 2);
            setTokenRankingPoints(proj?.tokenRankingPoints || 1);
            if (bgVal) setBgUri(bgVal);

            updateFavicon(logoVal);
            setBranding({
              name: nameVal,
              logoUrl: resolveIpfsUrl(logoVal) || null,
              themeColor: themeVal || null,
              nothingRewardImage: proj?.nothingRewardImage || null,
            });
            document.title = `${nameVal} | Leaderboard`;
          } else if (active) {
            let nameVal = slug;
            let bgVal = "";
            let logoVal = "";
            let themeVal = "";
            if (typeof window !== "undefined") {
              const localBranding = localStorage.getItem(`project_branding_${slug}`);
              if (localBranding) {
                try {
                  const parsed = JSON.parse(localBranding);
                  nameVal = parsed.name || nameVal;
                  bgVal = parsed.bgUri || "";
                  logoVal = parsed.logoUri || "";
                  themeVal = parsed.themeColor || "";
                } catch {}
              }
            }
            setProjectTitle(nameVal);
            if (bgVal) setBgUri(bgVal);

            updateFavicon(logoVal);
            setBranding({
              name: nameVal,
              logoUrl: resolveIpfsUrl(logoVal) || null,
              themeColor: themeVal || null,
            });
            document.title = `${nameVal} | Leaderboard`;
          }
        } catch (e) {
          console.warn("Failed to fetch project details:", e);
          let nameVal = slug;
          let bgVal = "";
          let logoVal = "";
          let themeVal = "";
          if (typeof window !== "undefined") {
            const localBranding = localStorage.getItem(`project_branding_${slug}`);
            if (localBranding) {
              try {
                const parsed = JSON.parse(localBranding);
                nameVal = parsed.name || nameVal;
                bgVal = parsed.bgUri || "";
                logoVal = parsed.logoUri || "";
                themeVal = parsed.themeColor || "";
              } catch {}
            }
          }
          setProjectTitle(nameVal);
          if (bgVal) setBgUri(bgVal);

          updateFavicon(logoVal);
          setBranding({
            name: nameVal,
            logoUrl: resolveIpfsUrl(logoVal) || null,
            themeColor: themeVal || null,
          });
          document.title = `${nameVal} | Leaderboard`;
        }

        // 2. Fetch project mystery boxes to track SOL vs Token currencies
        setProgressMsg("Reading box currency specifications...");
        const allPkgs = await retryWithBackoff(
          () => conn.getProgramAccounts(PGID),
          "getProgramAccounts(leaderboard_boxes)"
        );
        const coder = new BorshAccountsCoder(IDL as any);
        const solBoxesMap = new Map<string, boolean>();

        for (const { pubkey, account } of allPkgs) {
          try {
            const b: any = coder.decode("BoxConfig", account.data);
            const isMatch = b.project.equals(projectPDA);
            if (isMatch) {
              const price = b.priceLamports?.toNumber?.() ?? b.price_lamports?.toNumber?.() ?? b.priceLamports ?? b.price_lamports ?? 0;
              solBoxesMap.set(pubkey.toBase58(), price > 0);
            }
          } catch {}
        }

        // 3. Fetch leaderboard records off-chain
        setProgressMsg("Loading rankings from off-chain database...");
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

    const userMap = new Map<string, { points: number; opens: number }>();

    for (const ev of events) {
      if (ev.timestamp >= periodStart) {
        const pointsAwarded = ev.isSolBox ? solRankingPoints : tokenRankingPoints;
        const current = userMap.get(ev.user) || { points: 0, opens: 0 };
        userMap.set(ev.user, {
          points: current.points + pointsAwarded,
          opens: current.opens + 1,
        });
      }
    }

    const sorted: LeaderboardUser[] = Array.from(userMap.entries()).map(([wallet, stats]) => ({
      wallet,
      username: getUsername(wallet),
      avatar: getAvatar(wallet),
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
      className="min-h-screen text-gray-100 flex flex-col"
      style={resolvedBgUri ? {
        backgroundImage: `radial-gradient(circle at top, rgba(10, 10, 10, 0.4) 0%, rgba(10, 10, 10, 0.85) 100%), url('${resolvedBgUri}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
      } : {
        backgroundColor: '#0a0a0a'
      }}
    >
      <div className="flex-grow pb-12">
        {/* Hero header */}
      <div className={`relative overflow-hidden py-16 ${resolvedBgUri ? "bg-transparent" : "bg-gradient-to-b from-[#111] via-[#0d0d0d]/80 to-[#0a0a0a] border-b border-white/[0.04]"}`}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(57,255,20,0.06),transparent_60%)] pointer-events-none" />
        <div className="relative max-w-5xl mx-auto px-5 text-center space-y-4">
          <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-tight" style={resolvedBgUri ? { textShadow: "0 2px 10px rgba(0,0,0,0.95)" } : {}}>
            {projectTitle} <span className="text-[#39ff14] drop-shadow-[0_0_20px_rgba(57,255,20,0.25)]">Leaderboard</span>
          </h1>
          <p className="text-sm text-gray-300 max-w-lg mx-auto leading-relaxed" style={resolvedBgUri ? { textShadow: "0 1px 6px rgba(0,0,0,0.95)" } : {}}>
            Rankings for {projectTitle}. Solana box openings earn <span className="text-[#39ff14] font-semibold">{solRankingPoints} {solRankingPoints === 1 ? "point" : "points"}</span>, and token openings earn <span className="text-[#39ff14] font-semibold">{tokenRankingPoints} {tokenRankingPoints === 1 ? "point" : "points"}</span>.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 mt-10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="h-8 w-8 border-2 border-[#39ff14] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-gray-500 uppercase tracking-widest">{progressMsg}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Control bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-2 bg-[#111]/60 border border-white/[0.06] rounded-2xl backdrop-blur-xl">
              {/* Weekly / Monthly tabs */}
              <div className="grid grid-cols-2 gap-1 w-full sm:w-auto sm:mx-auto">
                <button
                  onClick={() => setActiveTab("weekly")}
                  className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === "weekly"
                      ? "bg-[#39ff14] text-black shadow-[0_0_20px_rgba(57,255,20,0.3)]"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  <FiClock className="text-sm" /> Weekly
                </button>
                <button
                  onClick={() => setActiveTab("monthly")}
                  className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    activeTab === "monthly"
                      ? "bg-[#39ff14] text-black shadow-[0_0_20px_rgba(57,255,20,0.3)]"
                      : "text-gray-400 hover:text-white"
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
                  const rankColor = isGold ? "border-amber-400 text-amber-400" : isSilver ? "border-gray-300 text-gray-300" : "border-amber-600 text-amber-600";
                  const shadowColor = isGold ? "shadow-[0_0_40px_rgba(245,158,11,0.15)]" : isSilver ? "shadow-[0_0_30px_rgba(209,213,219,0.08)]" : "shadow-[0_0_20px_rgba(180,83,9,0.06)]";

                  return (
                    <motion.div
                      key={user.wallet}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex flex-col items-center justify-end rounded-t-3xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-[#111] p-4 text-center ${heightClass} ${shadowColor}`}
                    >
                      {/* Avatar */}
                      <div className="relative group">
                        <img
                          src={user.avatar}
                          alt={user.username}
                          className="h-12 w-12 sm:h-16 sm:w-16 rounded-full border-2 border-white/[0.08] bg-[#0a0a0a] group-hover:scale-105 transition-transform"
                        />
                        <span className={`absolute -bottom-1 -right-1 h-5 w-5 rounded-full border bg-black text-[10px] font-black flex items-center justify-center ${rankColor}`}>
                          {user.rank}
                        </span>
                      </div>

                      {/* Name */}
                      <p className="text-xs font-black text-white mt-4 truncate max-w-full">
                        {user.username}
                      </p>
                      <p className="text-[10px] text-gray-500 font-mono mt-0.5 truncate max-w-full">
                        {user.wallet.slice(0, 8)}…
                      </p>

                      {/* Score */}
                      <div className="mt-4 bg-black/60 rounded-xl py-1.5 px-3 border border-white/[0.06] w-full">
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest leading-none">Points</p>
                        <p className="text-sm font-black text-[#39ff14] mt-1">{user.points}</p>
                        <p className="text-[9px] text-gray-500 mt-0.5 font-semibold">{user.opens} opens</p>
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
                <p className="text-gray-400 text-sm mt-3">No activity logged for {projectTitle} yet.</p>
                <p className="text-gray-600 text-xs mt-1">Open packs from this storefront to climb the leaderboard!</p>
              </div>
            ) : (
              <div className="glass-panel rounded-2xl overflow-hidden border border-white/[0.06]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                        <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-gray-500">Rank</th>
                        <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-gray-500">Opener</th>
                        <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-gray-500">Total Opens</th>
                        <th className="py-4 px-5 text-xs font-bold uppercase tracking-wider text-gray-500 text-right">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRankings.map((user, idx) => {
                        const isTopThree = (user.rank || 0) <= 3;
                        const rankColor =
                          user.rank === 1 ? "text-amber-400" :
                          user.rank === 2 ? "text-gray-300" :
                          user.rank === 3 ? "text-amber-600" : "text-gray-400";

                        const isCurrentUser = wallet.publicKey && wallet.publicKey.toBase58() === user.wallet;

                        return (
                          <motion.tr
                            key={user.wallet}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.03 }}
                            className={`border-b border-white/[0.04] last:border-none hover:bg-white/[0.02] transition-colors ${
                              isCurrentUser ? "bg-[#39ff14]/[0.03] border-l-2 border-l-[#39ff14]" : ""
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
                                  className="h-8 w-8 rounded-full bg-[#111] border border-white/[0.08]"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-bold text-white hover:text-[#39ff14] cursor-pointer">
                                      {user.username}
                                    </span>
                                    {isCurrentUser && (
                                      <span className="text-[8px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-[#39ff14]/20 text-[#39ff14] border border-[#39ff14]/30 font-black">
                                        You
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-gray-500 font-mono mt-0.5 truncate max-w-[150px] sm:max-w-xs" title={user.wallet}>
                                    {user.wallet}
                                  </p>
                                </div>
                              </div>
                            </td>

                            {/* Total Opens */}
                            <td className="py-4 px-5">
                              <div className="flex items-center gap-1.5 text-xs text-gray-300 font-semibold">
                                <FiActivity className="text-gray-500 text-sm" />
                                {user.opens}
                              </div>
                            </td>

                            {/* Points */}
                            <td className="py-4 px-5 text-right">
                              <div className="flex items-center justify-end gap-1 font-mono font-bold text-[#39ff14]">
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
                  <div className="p-4 bg-white/[0.02] text-center border-t border-white/[0.04]">
                    <p className="text-[11px] text-gray-500">
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
      <footer className="border-t border-white/[0.06] mt-auto bg-black/20 backdrop-blur-md">
        <div className="mx-auto max-w-5xl px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-black">
              <span className="text-[#39ff14]">Geck</span><span className="text-white/50">ura</span>
            </span>
            <span className="text-xs text-gray-500">© 2026 Geckura. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>
              Made with <span className="text-red-500 animate-pulse">❤️</span> by{" "}
              <a 
                href="https://x.com/geckura" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-[#39ff14] hover:text-white font-semibold transition-colors"
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
