"use client";

import { Suspense, useCallback, useEffect, useState, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildConn, decodeAccount, fetchProjects, fetchAllBoxes, fetchAllPrizeItems, retryWithBackoff, ixInitializePlatform, platformPDA, vaultPDA, sendIx, getSolanaErrorDetails } from "@/lib/program-ix";
import { updateProjectFeesTx, fetchRentInfoForProject, adminSweepBoxRentTx, closeProjectTx, type ProjectRentInfo, type SweepableBox, sweepVaultAtaRentTx, type SweepableVaultAta } from "@/lib/actions";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { FiLayers, FiBox, FiDollarSign, FiTrendingUp, FiSettings, FiEdit3, FiCheck, FiX, FiShield, FiDatabase, FiDownload } from "react-icons/fi";
import toast from "react-hot-toast";

const TREASURY_WALLET = new PublicKey("FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq");

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
};

function Overview() {
  const wallet = useWallet();
  const { connected, publicKey } = wallet;
  const [platform, setPlatform] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [allBoxes, setAllBoxes] = useState<any[]>([]);
  const [allPrizeItems, setAllPrizeItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(!connected);
  const [initializing, setInitializing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editProjectSlug, setEditProjectSlug] = useState<string | null>(null);
  const [editFeeWallet, setEditFeeWallet] = useState<string>("");
  const [editFeeWallet2, setEditFeeWallet2] = useState<string>("");
  const [editFeeLamports, setEditFeeLamports] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [rentInfoMap, setRentInfoMap] = useState<Record<string, ProjectRentInfo>>({});
  const [sweepingBox, setSweepingBox] = useState<string | null>(null);
  const [expandedRentSlug, setExpandedRentSlug] = useState<string | null>(null);
  const [loadingRent, setLoadingRent] = useState(false);
  const [pausingSlug, setPausingSlug] = useState<string | null>(null);
  const [dbEventsCount, setDbEventsCount] = useState<number>(0);


  const platformStats = useMemo(() => {
    const onChainSum = allBoxes.reduce((sum, box) => sum + (box.sold ?? 0), 0);
    const totalBoxesOpened = Math.max(dbEventsCount, onChainSum);
    let totalPlatformRevenueSol = 0;

    projects.forEach((project) => {
      const feeLamportsPerBox = project.feeLamports ?? 0;
      const projectBoxes = allBoxes.filter((box) => 
        box.project?.toBase58?.() === project.pubkey || box.project === project.pubkey
      );
      const totalBoxesSoldForProject = projectBoxes.reduce((sum, box) => sum + (box.sold ?? 0), 0);
      
      const projectRatio = onChainSum > 0 ? (totalBoxesSoldForProject / onChainSum) : 0;
      const resolvedProjectOpens = onChainSum > 0
        ? Math.max(totalBoxesSoldForProject, Math.round(totalBoxesOpened * projectRatio))
        : totalBoxesSoldForProject;

      totalPlatformRevenueSol += resolvedProjectOpens * (feeLamportsPerBox / 1e9);
    });

    return {
      totalProjects: projects.length,
      totalBoxesOpened,
      totalPlatformRevenueSol,
    };
  }, [projects, allBoxes, dbEventsCount]);

  const refresh = useCallback(async () => {
    setErr(null);
    const conn = buildConn();
    const [pPda] = await platformPDA();
    const acc = await retryWithBackoff(() => conn.getAccountInfo(pPda), "getAccountInfo(platform-config)").catch(() => null);
    if (acc) {
      try { setPlatform(decodeAccount("PlatformConfig", acc.data)); }
      catch { setPlatform({ authority: acc.owner.toBase58(), treasury: "?", isPaused: false }); }
    } else {
      setPlatform(null);
    }
    const [projectsData, allBoxesData, allPrizeItemsData] = await Promise.all([
      fetchProjects(),
      fetchAllBoxes(),
      fetchAllPrizeItems(),
    ]);
    try {
      const leaderRes = await fetch("/api/leaderboard");
      if (leaderRes.ok) {
        const data = await leaderRes.json();
        if (Array.isArray(data)) {
          setDbEventsCount(data.length);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch database leaderboard stats:", e);
    }
    setAllPrizeItems(allPrizeItemsData);
    const detailedProjects = await Promise.all(
      projectsData.map(async (p) => {
        try {
          const programId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "HnysT79HmiJWWtE8W2LWbhBeXk27RxoohbJ4cQyw8AKr");
          const [projectPda] = await PublicKey.findProgramAddressSync(
            [Buffer.from("project"), Buffer.from(p.slug)],
            programId
          );
          const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
          const accInfo = await conn.getAccountInfo(projectPda);
          if (accInfo) {
            const decoded = decodeAccount("Project", accInfo.data);
            return {
              ...p,
              feeWallet: decoded.feeWallet.toBase58(),
              feeWallet2: decoded.feeWallet2.toBase58(),
              feeLamports: decoded.feeLamports,
              authority: decoded.authority.toBase58(),
              pubkey: projectPda.toBase58(),
              isActive: decoded.isActive,
              rentClaimMode: decoded.rentClaimMode ?? 0,
            };
          }
          return p;
        } catch (e) {
          console.error("Failed to fetch project details:", e);
          return p;
        }
      })
    );
    setProjects(detailedProjects);
    setAllBoxes(allBoxesData);

    // Fetch rent info and empty vault ATAs for all projects
    setLoadingRent(true);
    try {
      const rentMap: Record<string, ProjectRentInfo> = {};
      await Promise.all(
        detailedProjects.map(async (p) => {
          try {
            const info = await fetchRentInfoForProject(p.slug, allBoxesData, allPrizeItemsData);
            rentMap[p.slug] = info;
          } catch (e) {
            console.error(`Failed to fetch rent for ${p.slug}:`, e);
          }
        })
      );
      setRentInfoMap(rentMap);
    } catch (e) {
      console.error("Failed to fetch rent info:", e);
    } finally {
      setLoadingRent(false);
    }
  }, []);

  const initializePlatform = useCallback(async () => {
    if (!wallet.publicKey) return;
    setErr(null);
    setInitializing(true);
    try {
      const [platformPda] = await platformPDA();
      const ix = ixInitializePlatform(platformPda, wallet.publicKey, TREASURY_WALLET);
      await sendIx(ix, wallet);
      toast.success("Platform initialized successfully!");
      await refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
      toast.error("Failed to initialize platform.");
    } finally {
      setInitializing(false);
    }
  }, [wallet, refresh]);

  const handleSave = useCallback(async (slug: string) => {
    if (!wallet.publicKey) return;
    setSaving(true);
    try {
      const feeWallet = new PublicKey(editFeeWallet);
      const feeWallet2 = new PublicKey(editFeeWallet2 || editFeeWallet);
      const feeSol = parseFloat(editFeeLamports);
      if (isNaN(feeSol) || feeSol < 0) {
        throw new Error("Fee must be a non-negative number");
      }
      const feeLamports = Math.round(feeSol * 1e9);
      await updateProjectFeesTx(wallet, slug, feeWallet, feeWallet2, feeLamports);
      setEditProjectSlug(null);
      toast.success("Fees updated successfully!");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save fees");
    } finally {
      setSaving(false);
    }
  }, [wallet, editFeeWallet, editFeeWallet2, editFeeLamports, refresh]);

  const handleSweepBox = useCallback(async (slug: string, box: SweepableBox) => {
    if (!wallet.publicKey) return;
    const sweepKey = `${slug}-${box.boxId}`;
    setSweepingBox(sweepKey);
    try {
      const sig = await adminSweepBoxRentTx(wallet, {
        slug,
        boxId: box.boxId,
        prizeIndices: box.prizeItems.map((p) => p.index),
      });
      toast.success(`Swept ${(box.totalLamports / 1e9).toFixed(4)} SOL rent from "${box.boxName}"`);
      await refresh();
    } catch (e: any) {
      console.error("[SweepRentError]", e);
      toast.error(getSolanaErrorDetails(e));
    } finally {
      setSweepingBox(null);
    }
  }, [wallet, refresh]);

  const handleSweepAta = useCallback(async (slug: string, vaultTokenAccount: string) => {
    if (!wallet.publicKey) return;
    const sweepKey = `${slug}-${vaultTokenAccount}`;
    setSweepingBox(sweepKey);
    try {
      await sweepVaultAtaRentTx(wallet, {
        slug,
        vaultTokenAccount,
      });
      toast.success(`Swept empty vault ATA rent (0.002 SOL)`);
      await refresh();
    } catch (e: any) {
      console.error("[SweepAtaError]", e);
      toast.error(getSolanaErrorDetails(e));
    } finally {
      setSweepingBox(null);
    }
  }, [wallet, refresh]);

  const handleCloseProject = useCallback(async (slug: string) => {
    if (!wallet.publicKey) return;
    setPausingSlug(slug);
    try {
      await closeProjectTx(wallet, slug);
      toast.success(`Successfully paused/deactivated project "${slug}"`);
      await refresh();
    } catch (e: any) {
      console.error("[CloseProjectError]", e);
      toast.error(getSolanaErrorDetails(e));
    } finally {
      setPausingSlug(null);
    }
  }, [wallet, refresh]);



  useEffect(() => {
    (async () => {
      if (connected) { await refresh(); setLoading(false); }
      else setLoading(false);
    })();
  }, [connected, refresh]);

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-purple-500/20 to-indigo-500/20 flex items-center justify-center mb-4 ring-1 ring-white/10">
          <FiShield className="w-10 h-10 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Admin Dashboard</h2>
          <p className="text-[#3d6b4e] mt-2 max-w-md mx-auto">Connect your wallet to access platform analytics, manage projects, and configure global settings.</p>
        </div>
      </div>
    );
  }

  if (publicKey?.toBase58() !== "FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="w-24 h-24 rounded-full bg-red-500/10 flex items-center justify-center mb-4 ring-1 ring-red-500/20">
          <FiShield className="w-10 h-10 text-red-500" />
        </div>
        <div>
          <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-red-400">Access Denied</h2>
          <p className="text-red-400 mt-2 max-w-md mx-auto">Only the platform admin wallet (FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq) is authorized to access the Admin Dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div 
      initial="hidden" 
      animate="show" 
      variants={containerVariants} 
      className="space-y-10 max-w-7xl mx-auto"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-indigo-100 to-indigo-300">
            Platform Overview
          </h1>
          <p className="text-sm text-indigo-200/60 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            {projects.length} Active Project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        {platform ? (
          <Link 
            href="/admin/new" 
            className="group relative px-6 py-2.5 rounded-xl font-semibold text-sm overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-600 transition-transform duration-300 group-hover:scale-105" />
            <div className="absolute inset-0 opacity-0 group-hover:opacity-20 bg-white mix-blend-overlay transition-opacity duration-300" />
            <span className="relative flex items-center gap-2 text-[#0f2618]">
              <FiLayers /> New Project
            </span>
          </Link>
        ) : (
          <button
            onClick={initializePlatform}
            disabled={initializing || !publicKey}
            className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl text-sm font-semibold text-[#0f2618] shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 transition-all disabled:opacity-50"
          >
            {initializing ? "Initializing..." : "Initialize Platform"}
          </button>
        )}
      </motion.div>

      {err && (
        <motion.div variants={itemVariants} className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-3">
          <FiX className="w-5 h-5 shrink-0" />
          <p className="text-sm">{err}</p>
        </motion.div>
      )}

      {/* Stats Grid */}
      <motion.div variants={containerVariants} className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div variants={itemVariants} className="relative overflow-hidden bg-[#1cac64]/3 border border-white/[0.05] rounded-2xl p-6 group hover:bg-[#1cac64]/5 transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <FiLayers className="w-16 h-16 text-indigo-400" />
          </div>
          <p className="text-xs text-indigo-300/70 uppercase tracking-widest font-semibold flex items-center gap-2 mb-2">
            Total Projects
          </p>
          <p className="text-4xl font-black text-[#0f2618] font-mono">{platformStats.totalProjects}</p>
        </motion.div>

        <motion.div variants={itemVariants} className="relative overflow-hidden bg-[#1cac64]/3 border border-white/[0.05] rounded-2xl p-6 group hover:bg-[#1cac64]/5 transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <FiBox className="w-16 h-16 text-purple-400" />
          </div>
          <p className="text-xs text-purple-300/70 uppercase tracking-widest font-semibold flex items-center gap-2 mb-2">
            Boxes Opened
          </p>
          <p className="text-4xl font-black text-[#0f2618] font-mono">{platformStats.totalBoxesOpened.toLocaleString()}</p>
        </motion.div>

        <motion.div variants={itemVariants} className="relative overflow-hidden bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-6 group hover:bg-emerald-500/10 transition-colors">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <FiDollarSign className="w-16 h-16 text-emerald-400" />
          </div>
          <p className="text-xs text-emerald-400/80 uppercase tracking-widest font-semibold flex items-center gap-2 mb-2 relative z-10">
            Platform Revenue
          </p>
          <p className="text-4xl font-black text-emerald-400 font-mono relative z-10">{platformStats.totalPlatformRevenueSol.toFixed(4)} <span className="text-lg">SOL</span></p>
        </motion.div>

        <motion.div variants={itemVariants} className="relative overflow-hidden bg-fuchsia-500/5 border border-fuchsia-500/10 rounded-2xl p-6 group hover:bg-fuchsia-500/10 transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <FiTrendingUp className="w-16 h-16 text-fuchsia-400" />
          </div>
          <p className="text-xs text-fuchsia-400/80 uppercase tracking-widest font-semibold flex items-center gap-2 mb-2">
            Avg Fee / Box
          </p>
          <p className="text-3xl font-black text-fuchsia-300 font-mono">
            {projects.length > 0 
              ? (projects.reduce((sum, p) => sum + (p.feeLamports ?? 0), 0) / projects.length / 1e9).toFixed(5)
              : "0.000"} <span className="text-base text-fuchsia-400/60">SOL</span>
          </p>
        </motion.div>

        <motion.div variants={itemVariants} className="relative overflow-hidden bg-amber-500/5 border border-amber-500/10 rounded-2xl p-6 group hover:bg-amber-500/10 transition-colors col-span-2 md:col-span-4">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <FiDownload className="w-16 h-16 text-amber-400" />
          </div>
          <div className="relative z-10">
            <p className="text-xs text-amber-400/85 uppercase tracking-widest font-semibold flex items-center gap-2 mb-2">
              <FiBox className="w-3 h-3 text-indigo-400" /> Box PDA Rent
            </p>
            <p className="text-4xl font-black text-[#0f2618] font-mono">
              {loadingRent ? (
                <span className="text-lg animate-pulse">Scanning...</span>
              ) : (
                <>{(Object.values(rentInfoMap).reduce((sum, info) => sum + info.totalRentLamports, 0) / 1e9).toFixed(4)} <span className="text-sm text-[#2d5a3f] font-normal">SOL</span></>
              )}
            </p>
            <p className="text-xs text-amber-300/50 mt-1">
              {Object.values(rentInfoMap).reduce((s, r) => s + r.sweepableBoxes.length, 0)} sweepable box PDA{Object.values(rentInfoMap).reduce((s, r) => s + r.sweepableBoxes.length, 0) !== 1 ? "s" : ""}
            </p>
          </div>
        </motion.div>
      </motion.div>

      {/* Platform Config & Projects Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Platform Config */}
        <motion.div variants={itemVariants} className="lg:col-span-4 space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <FiSettings className="text-indigo-400" /> Global Settings
          </h3>
          <div className="bg-[#1cac64]/3 border border-white/[0.05] rounded-3xl p-6 backdrop-blur-xl space-y-6">
            <div>
              <p className="text-xs text-[#3d6b4e] uppercase tracking-widest mb-2 font-semibold">Authority</p>
              <div className="bg-[#ebfde3]/60 rounded-xl p-3 border border-white/[0.05]">
                <p className="font-mono text-xs text-indigo-300 break-all">{platform?.authority || "Not initialized"}</p>
              </div>
            </div>
            
            <div>
              <p className="text-xs text-[#3d6b4e] uppercase tracking-widest mb-2 font-semibold">Treasury</p>
              <div className="bg-[#ebfde3]/60 rounded-xl p-3 border border-white/[0.05]">
                <p className="font-mono text-xs text-emerald-300 break-all">{platform?.treasury || "—"}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/[0.05]">
              <p className="text-xs text-[#3d6b4e] uppercase tracking-widest font-semibold">Platform Status</p>
              <div className={`px-3 py-1 rounded-full text-xs font-bold border ${platform?.isPaused ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"}`}>
                {platform?.isPaused ? "PAUSED" : "ACTIVE"}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Right Column: Projects List */}
        <motion.div variants={itemVariants} className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FiDatabase className="text-purple-400" /> Managed Projects
            </h3>
          </div>

          {projects.length === 0 ? (
            <div className="bg-[#1cac64]/3 border border-white/[0.05] rounded-3xl p-12 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-white/[0.05] flex items-center justify-center mb-4">
                <FiLayers className="w-8 h-8 text-[#3d6b4e]" />
              </div>
              <p className="text-[#2d5a3f]">No projects yet. Create your first mystery box project!</p>
              <Link href="/admin/new" className="mt-4 px-6 py-2 bg-white/10 hover:bg-white/15 rounded-full text-sm font-semibold transition-colors">
                Create Project
              </Link>
            </div>
          ) : (
            <motion.div variants={containerVariants} className="space-y-3">
              {projects.map((p) => (
                <motion.div 
                  key={p.pubkey} 
                  variants={itemVariants}
                  className="group bg-[#1cac64]/3 border border-white/[0.05] hover:bg-[#1cac64]/5 hover:border-indigo-500/30 rounded-2xl p-5 transition-all duration-300"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    {/* Project Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-4 mb-2">
                        {p.logoUri ? (
                          <img src={p.logoUri} alt="" className="w-12 h-12 rounded-xl object-cover ring-1 ring-white/10" />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xl font-black text-[#0f2618] shadow-inner">
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-lg font-bold text-[#0f2618] truncate">{p.name}</h4>
                            <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${p.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                              {p.isActive ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <p className="text-xs text-[#3d6b4e] font-mono truncate">{p.slug}</p>
                        </div>
                      </div>
                      <p className="text-sm text-[#2d5a3f] line-clamp-1 ml-16">{p.description || "No description provided."}</p>
                    </div>

                    {/* Fees & Actions */}
                    <div className="md:w-80 shrink-0 bg-[#ebfde3]/60 rounded-xl p-4 border border-white/[0.02]">
                      <AnimatePresence mode="wait">
                        {editProjectSlug === p.slug ? (
                          <motion.div 
                            key="edit"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="space-y-3"
                          >
                            <div>
                              <label className="text-[10px] text-[#3d6b4e] uppercase font-bold mb-1 block">Fee Wallet 1 (Primary 50%)</label>
                              <input
                                value={editFeeWallet}
                                onChange={(e) => setEditFeeWallet(e.target.value)}
                                className="w-full bg-[#1cac64]/8 border border-[#1cac64]/15 rounded-lg px-3 py-1.5 text-xs font-mono text-[#0f2618] focus:outline-none focus:border-indigo-500 transition-colors"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-[#3d6b4e] uppercase font-bold mb-1 block">Fee Wallet 2 (Secondary 50%)</label>
                              <input
                                value={editFeeWallet2}
                                onChange={(e) => setEditFeeWallet2(e.target.value)}
                                className="w-full bg-[#1cac64]/8 border border-[#1cac64]/15 rounded-lg px-3 py-1.5 text-xs font-mono text-[#0f2618] focus:outline-none focus:border-indigo-500 transition-colors"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-[#3d6b4e] uppercase font-bold mb-1 block">Fee per Box (SOL)</label>
                              <input
                                type="number"
                                step="0.000000001"
                                value={editFeeLamports}
                                onChange={(e) => setEditFeeLamports(e.target.value)}
                                className="w-full bg-[#1cac64]/8 border border-[#1cac64]/15 rounded-lg px-3 py-1.5 text-xs text-[#0f2618] focus:outline-none focus:border-indigo-500 transition-colors"
                              />
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button
                                onClick={() => setEditProjectSlug(null)}
                                className="flex-1 py-1.5 rounded-lg border border-[#1cac64]/15 text-xs font-semibold text-[#2d5a3f] hover:text-[#0f2618] hover:bg-[#1cac64]/8 transition"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleSave(p.slug)}
                                disabled={saving}
                                className="flex-1 py-1.5 rounded-lg bg-indigo-600 text-xs font-semibold text-[#0f2618] hover:bg-indigo-500 disabled:opacity-50 transition flex items-center justify-center gap-1"
                              >
                                {saving ? <span className="animate-pulse">Saving...</span> : <><FiCheck /> Save</>}
                              </button>
                            </div>
                          </motion.div>
                        ) : (
                          <motion.div 
                            key="view"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="space-y-3"
                          >
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-[#3d6b4e]">Fee Wallet</span>
                              <span className="font-mono text-indigo-300 truncate w-32 text-right">{p.feeWallet.slice(0, 4)}…{p.feeWallet.slice(-4)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-[#3d6b4e]">Platform Fee</span>
                              <span className="font-mono text-emerald-400 font-bold">{((p.feeLamports ?? 0) / 1e9).toFixed(5)} SOL</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-[#3d6b4e]">Rent Recipient</span>
                              <span className="font-mono text-indigo-400 font-semibold">{p.rentClaimMode === 1 ? "Platform" : "Project"}</span>
                            </div>

                            {/* Rent Info */}
                            {rentInfoMap[p.slug] && (
                              <div className="pt-2 border-t border-white/[0.05]">
                                <div className="flex justify-between items-center text-xs">
                                  <span className="text-amber-400/80 flex items-center gap-1">
                                    <FiDownload className="w-3 h-3" /> Claimable Rent
                                  </span>
                                  <span className="font-mono text-amber-400 font-bold">
                                    {(rentInfoMap[p.slug].totalRentLamports / 1e9).toFixed(4)} SOL
                                  </span>
                                </div>
                                <p className="text-[10px] text-amber-300/40 mt-0.5">
                                  {rentInfoMap[p.slug].sweepableBoxes.length} box{rentInfoMap[p.slug].sweepableBoxes.length !== 1 ? "es" : ""} & {rentInfoMap[p.slug].sweepableVaultAtas?.length || 0} ATA{rentInfoMap[p.slug].sweepableVaultAtas?.length !== 1 ? "s" : ""} ready to sweep
                                </p>

                                {/* Expandable list */}
                                {(rentInfoMap[p.slug].sweepableBoxes.length > 0 || (rentInfoMap[p.slug].sweepableVaultAtas?.length || 0) > 0) && (
                                  <button
                                    onClick={() => setExpandedRentSlug(expandedRentSlug === p.slug ? null : p.slug)}
                                    className="mt-1.5 w-full text-[10px] text-amber-400/60 hover:text-amber-400 transition-colors text-left"
                                  >
                                    {expandedRentSlug === p.slug ? "▾ Hide details" : "▸ Show details"}
                                  </button>
                                )}

                                <AnimatePresence>
                                  {expandedRentSlug === p.slug && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar animate-fade-in">
                                        {rentInfoMap[p.slug].sweepableBoxes.map((box) => {
                                          const sweepKey = `${p.slug}-${box.boxId}`;
                                          const isSweeping = sweepingBox === sweepKey;
                                          return (
                                            <div
                                              key={box.boxId}
                                              className="flex items-center justify-between bg-[#1cac64]/3 rounded-lg px-2.5 py-1.5 border border-white/[0.03]"
                                            >
                                              <div className="min-w-0 flex-1">
                                                <p className="text-[11px] text-[#1a3a2a] truncate font-medium">{box.boxName}</p>
                                                <p className="text-[10px] text-[#3d6b4e]">
                                                  {box.sold}/{box.supply} sold · {box.prizeItems.length} prize{box.prizeItems.length !== 1 ? "s" : ""}
                                                </p>
                                              </div>
                                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                                <span className="text-[11px] font-mono text-amber-400 font-bold">
                                                  {(box.totalLamports / 1e9).toFixed(4)}
                                                </span>
                                                <button
                                                  onClick={() => handleSweepBox(p.slug, box)}
                                                  disabled={isSweeping}
                                                  className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/30 disabled:opacity-50 transition"
                                                >
                                                  {isSweeping ? "..." : "Claim"}
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })}

                                        {rentInfoMap[p.slug].sweepableVaultAtas?.map((ata) => {
                                          const sweepKey = `${p.slug}-${ata.pubkey}`;
                                          const isSweeping = sweepingBox === sweepKey;
                                          return (
                                            <div
                                              key={ata.pubkey}
                                              className="flex items-center justify-between bg-[#1cac64]/3 rounded-lg px-2.5 py-1.5 border border-white/[0.03]"
                                            >
                                              <div className="min-w-0 flex-1">
                                                <p className="text-[11px] text-[#1a3a2a] truncate font-medium">Empty Vault ATA</p>
                                                <p className="text-[10px] text-[#3d6b4e] truncate">
                                                  Mint: {ata.mint.slice(0, 4)}...{ata.mint.slice(-4)}
                                                </p>
                                              </div>
                                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                                <span className="text-[11px] font-mono text-amber-400 font-bold">
                                                  {(ata.lamports / 1e9).toFixed(4)}
                                                </span>
                                                <button
                                                  onClick={() => handleSweepAta(p.slug, ata.pubkey)}
                                                  disabled={isSweeping}
                                                  className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/30 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/30 disabled:opacity-50 transition"
                                                >
                                                  {isSweeping ? "..." : "Claim"}
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )}

                            <div className="flex gap-2 pt-2">
                              {p.isActive ? (
                                <button
                                  onClick={() => handleCloseProject(p.slug)}
                                  disabled={pausingSlug !== null}
                                  className="flex-1 py-1.5 rounded-lg bg-red-950/20 border border-red-800/30 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-950/35 transition flex items-center justify-center gap-1 disabled:opacity-50"
                                >
                                  {pausingSlug === p.slug ? (
                                    <span className="animate-pulse">Pausing...</span>
                                  ) : (
                                    <>
                                      <FiX className="w-3.5 h-3.5" /> Pause
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="flex-1 py-1.5 rounded-lg bg-red-500/5 border border-red-500/10 text-xs font-medium text-red-500/40 flex items-center justify-center gap-1 cursor-not-allowed select-none">
                                  <FiX className="w-3.5 h-3.5" /> Paused
                                </span>
                              )}
                              <button
                                onClick={() => {
                                  setEditProjectSlug(p.slug);
                                  setEditFeeWallet(p.feeWallet);
                                  setEditFeeWallet2(p.feeWallet2 || "");
                                  setEditFeeLamports(((p.feeLamports ?? 0) / 1e9).toString());
                                }}
                                className="flex-1 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.05] text-xs font-medium text-[#1a3a2a] hover:text-[#0f2618] hover:bg-white/10 transition flex items-center justify-center gap-1"
                              >
                                <FiEdit3 /> Edit Fees
                              </button>
                              <Link 
                                href={`/${p.slug}/admin`}
                                className="flex-1 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-xs font-semibold text-[#0f2618] hover:from-purple-500 hover:to-indigo-500 shadow-lg shadow-purple-500/20 text-center transition flex items-center justify-center gap-1"
                              >
                                Manage <FiTrendingUp />
                              </Link>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <Overview />
    </Suspense>
  );
}
