"use client";

import { useEffect, useState, useMemo } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { retryWithBackoff } from "@/lib/program-ix";
import IDL from "@/lib/idl.json";
import { FiDownload, FiUsers, FiActivity, FiAward } from "react-icons/fi";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { BorshAccountsCoder, BorshCoder, EventParser } from "@coral-xyz/anchor";

const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
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
  points: number;
  opens: number;
}

const adminLeaderboardCache: Record<string, { events: ParsedEvent[]; timestamp: number }> = {};

export default function AdminLeaderboard({ slug, refreshKey }: { slug: string; refreshKey?: number }) {
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [progressMsg, setProgressMsg] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "weekly" | "monthly">("all");
  const [solRankingPoints, setSolRankingPoints] = useState(2);
  const [tokenRankingPoints, setTokenRankingPoints] = useState(1);
  const [projectTitle, setProjectTitle] = useState("");
  
  const walletAddr = wallet.publicKey?.toBase58();
  
  // Refresh when refreshKey changes
  useEffect(() => {
    if (hasLoaded && refreshKey !== undefined) {
      setHasLoaded(false);
    }
  }, [refreshKey, hasLoaded]);
  
  // Automatically fetch leaderboard when hasLoaded is false and we're connected
  useEffect(() => {
    if (!hasLoaded && wallet.connected && walletAddr) {
      fetchLeaderboard();
    }
  }, [hasLoaded, wallet.connected, walletAddr, slug]);

  const fetchLeaderboard = async (force: any = false) => {
    if (loading) return;
    if (!wallet.publicKey) return;
    setLoading(true);
    setProgressMsg("Connecting to network...");
    
    try {
      const conn = new Connection(RPC, "confirmed");
      const [projectPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("project"), Buffer.from(slug)], PGID
      );

      // Fetch project details to get custom ranking points
      setProgressMsg("Reading project configuration...");
      try {
        const projectAcc = await retryWithBackoff(
          () => conn.getAccountInfo(projectPDA),
          "getAccountInfo(admin_leaderboard_project)"
        );

        if (projectAcc) {
          const coder = new BorshAccountsCoder(IDL as any);
          const proj: any = coder.decode("Project", projectAcc.data);
          const title = proj?.name || slug;
          setProjectTitle(title);
          setSolRankingPoints(proj?.solRankingPoints ?? 2);
          setTokenRankingPoints(proj?.tokenRankingPoints ?? 1);
        }
      } catch (err) {
        console.warn("Failed to fetch project details:", err);
      }

      setProgressMsg("Loading rankings from database...");
      let allEvents = [];
      const cached = adminLeaderboardCache[slug];
      const now = Date.now();
      const isForce = force === true;
      
      if (!isForce && cached && now - cached.timestamp < 10000) { // 10s memory cache
        allEvents = cached.events;
      } else {
        const res = await fetch(`/api/leaderboard?slug=${slug}`);
        if (res.ok) {
          allEvents = await res.json();
          adminLeaderboardCache[slug] = {
            events: allEvents,
            timestamp: Date.now()
          };
        }
      }
      
      setEvents(allEvents.sort((a: any, b: any) => b.timestamp - a.timestamp));
      setHasLoaded(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setProgressMsg("");
    }
  };

  const syncHistoricalData = async () => {
    if (!wallet.publicKey) return;
    setLoading(true);
    setProgressMsg("Starting sync from blockchain...");
    
    try {
      const conn = new Connection(RPC, "confirmed");
      const [projectPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("project"), Buffer.from(slug)], PGID
      );

      setProgressMsg("Reading box configurations...");
      const allPkgs = await retryWithBackoff(
        () => conn.getProgramAccounts(PGID),
        "getProgramAccounts(leaderboard_boxes)"
      );
      
      const coder = new BorshAccountsCoder(IDL as any);
      const solBoxesMap = new Map<string, boolean>();

      for (const { pubkey, account } of allPkgs) {
        try {
          const b: any = coder.decode("BoxConfig", account.data);
          if (b.project.equals(projectPDA)) {
            const price = b.priceLamports?.toNumber?.() ?? b.price_lamports?.toNumber?.() ?? b.priceLamports ?? b.price_lamports ?? 0;
            solBoxesMap.set(pubkey.toBase58(), price > 0);
          }
        } catch {}
      }

      setProgressMsg("Scanning blockchain signatures (limit 300)...");
      const sigInfos = await retryWithBackoff(
        () => conn.getSignaturesForAddress(PGID, { limit: 300 }),
        "getSignaturesForAddress"
      );

      setProgressMsg(`Parsing ${sigInfos.length} transactions from chain...`);
      const fullCoder = new BorshCoder(IDL as any);
      const parser = new EventParser(PGID, fullCoder);
      
      const newEvents: any[] = [];
      const BATCH_SIZE = 25;
      
      for (let i = 0; i < sigInfos.length; i += BATCH_SIZE) {
        const batch = sigInfos.slice(i, i + BATCH_SIZE).map(s => s.signature);
        setProgressMsg(`Parsing blockchain batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(sigInfos.length / BATCH_SIZE)}...`);

        try {
          const txDetailsList = await retryWithBackoff(
            () => conn.getParsedTransactions(batch, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            }),
            "getParsedTransactions"
          );

          for (let j = 0; j < txDetailsList.length; j++) {
            const tx = txDetailsList[j];
            const sig = batch[j];
            if (tx && tx.meta && tx.meta.logMessages) {
              const parsed = Array.from(parser.parseLogs(tx.meta.logMessages));
              for (const event of parsed) {
                if (event.name === "BoxOpenEvent") {
                  const data: any = event.data;
                  const boxCfgStr = (data.box_config ?? data.boxConfig)?.toBase58() ?? "";
                  
                  if (solBoxesMap.has(boxCfgStr)) {
                    const userStr = (data.user ?? data.User)?.toBase58() ?? "";
                    const timestampVal = (data.timestamp ?? data.Timestamp)?.toNumber?.() ?? Number(data.timestamp ?? 0);
                    const isSolBox = !!solBoxesMap.get(boxCfgStr);

                    newEvents.push({
                      slug,
                      sig,
                      user: userStr,
                      boxConfig: boxCfgStr,
                      timestamp: timestampVal,
                      isSolBox,
                    });
                  }
                }
              }
            }
          }
        } catch (err) {
          console.warn("Failed batch:", err);
        }
      }

      if (newEvents.length > 0) {
        setProgressMsg(`Uploading ${newEvents.length} events to database...`);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (wallet.signMessage && wallet.publicKey) {
          try {
            const timestamp = Math.floor(Date.now() / 1000);
            const messageStr = `Sync leaderboard for ${slug} at ${timestamp}`;
            const messageBytes = new TextEncoder().encode(messageStr);
            const signatureBytes = await wallet.signMessage(messageBytes);
            const signatureB64 = Buffer.from(signatureBytes).toString("base64");
            headers["X-Leaderboard-Signature"] = signatureB64;
            headers["X-Leaderboard-Signer"] = wallet.publicKey.toBase58();
            headers["X-Leaderboard-Timestamp"] = timestamp.toString();
          } catch (signErr: any) {
            console.error("Signing failed:", signErr);
            toast.error("You must sign the message to authorize syncing historical data.");
            setLoading(false);
            setProgressMsg("");
            return;
          }
        } else {
          toast.error("Wallet does not support message signing. Unable to sync.");
          setLoading(false);
          setProgressMsg("");
          return;
        }

        const syncRes = await fetch("/api/leaderboard", {
          method: "POST",
          headers,
          body: JSON.stringify(newEvents)
        });
        if (syncRes.ok) {
          const resData = await syncRes.json();
          toast.success(`Synced successfully! Added ${resData.added || 0} new records.`);
        } else {
          toast.error("Failed to upload synced events to backend API.");
        }
      } else {
        toast.success("No events found on-chain to sync.");
      }

      await fetchLeaderboard(true);
    } catch (err: any) {
      console.error(err);
      toast.error(`Sync failed: ${err.message || err}`);
    } finally {
      setLoading(false);
      setProgressMsg("");
    }
  };

  const rankings = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const secondsInPeriod = activeTab === "weekly" ? 7 * 86400 : activeTab === "monthly" ? 30 * 86400 : Infinity;
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

    return Array.from(userMap.entries()).map(([wallet, stats]) => ({
      wallet,
      points: stats.points,
      opens: stats.opens,
    })).sort((a, b) => b.points - a.points);
  }, [events, activeTab, solRankingPoints, tokenRankingPoints]);

  const downloadCSV = () => {
    const headers = ["Rank", "Wallet Address", "Total Opens", "Total Points"];
    const rows = rankings.map((r, i) => [
      i + 1,
      r.wallet,
      r.opens,
      r.points
    ]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map(e => e.join(","))
    ].join("\\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `geckurabox_snapshot_${slug}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div id="admin-leaderboard" className="bg-[#1cac64]/3 border border-white/[0.05] p-6 rounded-3xl mt-6 backdrop-blur-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="space-y-3">
          <h2 className="text-xl font-black text-[#0f2618] flex items-center gap-2">
            <FiUsers className="text-indigo-400" /> User Leaderboard Snapshot
          </h2>
          <p className="text-sm text-[#2d5a3f] mt-1 font-medium leading-relaxed">
            Pre-select timeframe to load quickly: Load <span className="text-[#1cac64] font-bold">{activeTab === "weekly" ? "weekly (7d)" : activeTab === "monthly" ? "monthly (30d)" : "all historical"}</span> open events to view the leaderboard and export a snapshot.
          </p>
          
          <div className="flex items-center gap-4 bg-[#1cac64]/8 border border-[#1cac64]/15 rounded-xl p-4">
            <div className="text-center">
              <div className="text-[#1cac64] font-black text-xl">{solRankingPoints}</div>
              <div className="text-[10px] text-[#2d5a3f] uppercase tracking-wider font-bold">SOL Box Points</div>
            </div>
            <div className="w-px bg-white/10 h-10" />
            <div className="text-center">
              <div className="text-[#1cac64] font-black text-xl">{tokenRankingPoints}</div>
              <div className="text-[10px] text-[#2d5a3f] uppercase tracking-wider font-bold">Token Box Points</div>
            </div>
            <div className="ml-4 text-xs text-[#2d5a3f]">
              Edit these in <button onClick={() => window.dispatchEvent(new CustomEvent('open-project-branding'))} className="text-indigo-300 hover:text-[#0f2618] underline cursor-pointer">Project Branding</button>
            </div>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-[#1cac64]/8 rounded-xl p-1 border border-white/5 backdrop-blur-md">
            <button onClick={() => setActiveTab("all")} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === "all" ? "bg-[#1cac64]/20 text-[#1cac64] border border-[#1cac64]/20 shadow-[0_0_15px_rgba(28,172,100,0.15)]" : "text-[#2d5a3f] hover:text-[#0f2618] hover:bg-[#1cac64]/8"}`}>All Time</button>
            <button onClick={() => setActiveTab("monthly")} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === "monthly" ? "bg-[#1cac64]/20 text-[#1cac64] border border-[#1cac64]/20 shadow-[0_0_15px_rgba(28,172,100,0.15)]" : "text-[#2d5a3f] hover:text-[#0f2618] hover:bg-[#1cac64]/8"}`}>Monthly</button>
            <button onClick={() => setActiveTab("weekly")} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${activeTab === "weekly" ? "bg-[#1cac64]/20 text-[#1cac64] border border-[#1cac64]/20 shadow-[0_0_15px_rgba(28,172,100,0.15)]" : "text-[#2d5a3f] hover:text-[#0f2618] hover:bg-[#1cac64]/8"}`}>Weekly</button>
          </div>

          <button
            onClick={() => fetchLeaderboard(true)}
            disabled={loading}
            className="px-4 py-2 bg-[#1cac64]/8 hover:bg-white/10 text-[#0f2618] text-sm font-bold rounded-xl border border-[#1cac64]/15 transition disabled:opacity-50"
          >
            {loading ? "Loading..." : hasLoaded ? "Refresh Data" : "Load Leaderboard"}
          </button>

          {hasLoaded && (
            <button
              onClick={syncHistoricalData}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 text-[#0f2618] text-sm font-bold rounded-xl border border-indigo-500/30 transition disabled:opacity-50"
            >
              {loading ? "Syncing..." : "Sync Historical Data"}
            </button>
          )}
          
          {hasLoaded && rankings.length > 0 && (
            <button
              onClick={downloadCSV}
              className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-[#0f2618] text-sm font-bold rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 transition flex items-center gap-2"
            >
              <FiDownload /> Export CSV
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="py-10 flex flex-col items-center text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs text-indigo-300 font-mono">{progressMsg}</p>
        </div>
      )}

      {hasLoaded && !loading && rankings.length === 0 && (
        <div className="py-10 text-center text-[#3d6b4e]">
          No boxes have been opened yet.
        </div>
      )}

      {hasLoaded && !loading && rankings.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#1cac64]/15 bg-[#ffffff]/40">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[#1cac64]/8 border-b border-[#1cac64]/15">
                <th className="py-3 px-4 text-xs font-bold text-[#2d5a3f] uppercase tracking-wider">Rank</th>
                <th className="py-3 px-4 text-xs font-bold text-[#2d5a3f] uppercase tracking-wider">Wallet</th>
                <th className="py-3 px-4 text-xs font-bold text-[#2d5a3f] uppercase tracking-wider">Opens</th>
                <th className="py-3 px-4 text-xs font-bold text-[#2d5a3f] uppercase tracking-wider text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {rankings.map((user, i) => (
                <tr key={user.wallet} className="border-b border-white/5 last:border-0 hover:bg-[#1cac64]/3">
                  <td className="py-3 px-4 text-sm font-black text-[#1a3a2a]">#{i + 1}</td>
                  <td className="py-3 px-4 text-sm font-mono text-[#1a3a2a]">{user.wallet}</td>
                  <td className="py-3 px-4 text-sm text-[#1a3a2a] flex items-center gap-1.5"><FiActivity className="text-[#3d6b4e]" /> {user.opens}</td>
                  <td className="py-3 px-4 text-sm font-black text-[#1cac64] text-right">{user.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
