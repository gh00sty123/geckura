"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { FiExternalLink, FiCompass } from "react-icons/fi";
import { fetchProjects, fetchAllBoxes } from "@/lib/program-ix";
import { resolveIpfsUrl } from "@/lib/helpers";
import Hero from "@/components/Hero";

export default function HomePage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const projs = await fetchProjects();
        const bxs = await fetchAllBoxes();
        setProjects(projs || []);
        setBoxes(bxs || []);
      } catch (err) {
        console.error("Error loading homepage directory:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Filter active/live projects
  const activeProjects = useMemo(() => {
    return projects.filter((p) => p.isActive);
  }, [projects]);

  // Group boxes by project
  const projectStats = useMemo(() => {
    const stats: Record<string, { count: number; minPrice: number; maxPrice: number }> = {};
    for (const b of boxes) {
      const projKey = b.project?.toBase58?.() || b.project?.toString?.() || "";
      if (!projKey) continue;
      
      const price = (b.priceLamports || 0) / 1e9;
      if (!stats[projKey]) {
        stats[projKey] = { count: 0, minPrice: price, maxPrice: price };
      }
      
      stats[projKey].count += 1;
      if (price < stats[projKey].minPrice) stats[projKey].minPrice = price;
      if (price > stats[projKey].maxPrice) stats[projKey].maxPrice = price;
    }
    return stats;
  }, [boxes]);

  const handleScrollToDirectory = () => {
    const el = document.getElementById("projects-directory");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100 pb-16">
      <div className="mx-auto max-w-[1440px] px-4 lg:px-6 py-6 lg:py-8 space-y-12">
        {/* ── HERO ── */}
        <Hero onOpenPack={handleScrollToDirectory} />

        {/* ── Directory Header ── */}
        <div id="projects-directory" className="space-y-4 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-[#39ff14] animate-pulse" />
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[#39ff14]">
              Platform Directory
            </h2>
          </div>
          <h3 className="text-2xl md:text-3xl font-black text-white">
            Active Projects & Mystery Drops
          </h3>
          <p className="text-sm text-gray-400 max-w-2xl leading-relaxed">
            Browse through the verified projects launching customizable mystery boxes on Geckura. Connect your wallet, explore their available drops, and review real-time pricing and odds.
          </p>
        </div>

        {/* ── Directory Grid ── */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-panel rounded-3xl p-6 h-[260px] animate-pulse space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/5" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-white/5 rounded w-1/2" />
                    <div className="h-3 bg-white/5 rounded w-1/3" />
                  </div>
                </div>
                <div className="h-16 bg-white/5 rounded-xl" />
                <div className="h-10 bg-white/5 rounded-xl" />
              </div>
            ))}
          </div>
        ) : activeProjects.length === 0 ? (
          <div className="glass-panel rounded-3xl p-12 text-center max-w-lg mx-auto border border-white/[0.06] space-y-4">
            <FiCompass className="text-4xl text-[#39ff14] mx-auto animate-spin" style={{ animationDuration: "8s" }} />
            <h4 className="text-base font-bold text-white">No Projects Live Yet</h4>
            <p className="text-xs text-gray-500">
              The platform is currently setting up the first cohort of creators. Check back soon for the official launch!
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activeProjects.map((proj) => {
              const stats = projectStats[proj.pubkey] || { count: 0, minPrice: 0, maxPrice: 0 };
              const logoUrl = resolveIpfsUrl(proj.logoUri);
              const hasPacks = stats.count > 0;
              const priceDisplay = !hasPacks
                ? "No active drops"
                : stats.minPrice === stats.maxPrice
                ? `${stats.minPrice.toFixed(2)} SOL`
                : `${stats.minPrice.toFixed(2)} - ${stats.maxPrice.toFixed(2)} SOL`;

              return (
                <motion.div
                  key={proj.pubkey}
                  whileHover={{ y: -6 }}
                  className="group relative flex flex-col justify-between glass-panel rounded-3xl p-6 border border-white/[0.06] hover:border-[#39ff14]/30 hover:shadow-[0_0_30px_rgba(57,255,20,0.08)] transition-all overflow-hidden"
                >
                  {/* Branding background tint */}
                  <div 
                    className="absolute inset-0 opacity-[0.02] group-hover:opacity-[0.04] transition-opacity duration-300"
                    style={{
                      backgroundColor: proj.themeColor || "#39ff14",
                    }}
                  />

                  <div className="space-y-4 relative z-10">
                    {/* Top row: Logo & Status */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3.5">
                        {logoUrl ? (
                          <img
                            src={logoUrl}
                            alt={proj.name}
                            className="w-12 h-12 rounded-2xl object-cover border border-white/[0.08] bg-black/40"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-2xl bg-[#39ff14]/10 border border-[#39ff14]/25 flex items-center justify-center text-lg shadow-inner">
                            🦎
                          </div>
                        )}
                        <div>
                          <h4 className="text-base font-bold text-white group-hover:text-[#39ff14] transition-colors">
                            {proj.name}
                          </h4>
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest font-mono">
                            /{proj.slug}
                          </span>
                        </div>
                      </div>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff14]/20 font-bold uppercase tracking-wider">
                        Active
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed min-h-[54px]">
                      {proj.description || "Explore and open premium Solana-powered mystery packs and win rare digital assets."}
                    </p>

                    {/* Project stats */}
                    <div className="grid grid-cols-2 gap-2.5 p-3 rounded-2xl bg-white/[0.02] border border-white/[0.04] text-xs font-medium">
                      <div>
                        <span className="text-[9px] text-gray-500 block uppercase tracking-wider">Active Drops</span>
                        <span className="text-white font-bold block mt-0.5">
                          {stats.count} {stats.count === 1 ? "Pack" : "Packs"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-gray-500 block uppercase tracking-wider">Pricing</span>
                        <span className="text-[#39ff14] font-bold block mt-0.5 truncate" title={priceDisplay}>
                          {priceDisplay}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-5 mt-auto relative z-10">
                    <Link href={`/${proj.slug}`}>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="w-full py-3 rounded-xl bg-white/[0.04] hover:bg-[#39ff14] hover:text-black border border-white/[0.08] hover:border-transparent text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer"
                      >
                        Explore Project
                        <FiExternalLink className="text-sm" />
                      </motion.button>
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.06] mt-16 pt-8 pb-4">
        <div className="mx-auto max-w-[1440px] px-4 lg:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-black">
              <span className="text-[#39ff14]">Geck</span><span className="text-white/50">ura</span>
            </span>
            <span className="text-xs text-gray-500">© 2026 Geckura. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-gray-400">
            <a href="#" className="hover:text-[#39ff14] transition-colors">Docs</a>
            <a href="#" className="hover:text-[#39ff14] transition-colors">Blog</a>
            <a href="#" className="hover:text-[#39ff14] transition-colors">Twitter</a>
            <a href="#" className="hover:text-[#39ff14] transition-colors">Discord</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
