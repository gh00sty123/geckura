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
    <div className="min-h-screen bg-[#ebfde3] text-[#1a3a2a] pb-16">
      <div className="mx-auto max-w-[1440px] px-4 lg:px-6 py-6 lg:py-8 space-y-12">
        {/* ── HERO ── */}
        <Hero onOpenPack={handleScrollToDirectory} />

        {/* ── Directory Header ── */}
        <div id="projects-directory" className="space-y-4 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="h-2 w-2 rounded-full bg-[#1cac64] animate-pulse" />
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[#1cac64]">
              Platform Directory
            </h2>
          </div>
          <h3 className="text-2xl md:text-3xl font-black text-[#1a3a2a]">
            Active Projects & Mystery Drops
          </h3>
          <p className="text-sm text-[#3d6b4e] max-w-2xl leading-relaxed">
            Browse through the verified projects launching customizable mystery boxes on Geckura. Connect your wallet, explore their available drops, and review real-time pricing and odds.
          </p>
        </div>

        {/* ── Directory Grid ── */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-panel rounded-3xl p-6 h-[260px] animate-pulse space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-[#1cac64]/10" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-[#1cac64]/10 rounded w-1/2" />
                    <div className="h-3 bg-[#1cac64]/10 rounded w-1/3" />
                  </div>
                </div>
                <div className="h-16 bg-[#1cac64]/10 rounded-xl" />
                <div className="h-10 bg-[#1cac64]/10 rounded-xl" />
              </div>
            ))}
          </div>
        ) : activeProjects.length === 0 ? (
          <div className="glass-panel rounded-3xl p-12 text-center max-w-lg mx-auto border border-[#1cac64]/15 space-y-4">
            <FiCompass className="text-4xl text-[#1cac64] mx-auto animate-spin" style={{ animationDuration: "8s" }} />
            <h4 className="text-base font-bold text-[#1a3a2a]">No Projects Live Yet</h4>
            <p className="text-xs text-[#6b9b7a]">
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
                  className="group relative flex flex-col justify-between glass-panel rounded-3xl p-6 border border-[#1cac64]/10 hover:border-[#1cac64]/30 hover:shadow-[0_0_30px_rgba(28,172,100,0.08)] transition-all overflow-hidden"
                >
                  {/* Branding background tint */}
                  <div 
                    className="absolute inset-0 opacity-[0.02] group-hover:opacity-[0.04] transition-opacity duration-300"
                    style={{
                      backgroundColor: proj.themeColor || "#1cac64",
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
                          <div className="w-12 h-12 rounded-2xl bg-[#1cac64]/10 border border-[#1cac64]/25 flex items-center justify-center text-lg shadow-inner">
                            🦎
                          </div>
                        )}
                        <div>
                          <h4 className="text-base font-bold text-[#1a3a2a] group-hover:text-[#1cac64] transition-colors">
                            {proj.name}
                          </h4>
                          <span className="text-[10px] text-[#6b9b7a] uppercase tracking-widest font-mono">
                            /{proj.slug}
                          </span>
                        </div>
                      </div>
                      <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#1cac64]/10 text-[#1cac64] border border-[#1cac64]/20 font-bold uppercase tracking-wider">
                        Active
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-[#3d6b4e] line-clamp-3 leading-relaxed min-h-[54px]">
                      {proj.description || "Explore and open premium Solana-powered mystery packs and win rare digital assets."}
                    </p>

                    {/* Project stats */}
                    <div className="grid grid-cols-2 gap-2.5 p-3 rounded-2xl bg-[#1cac64]/5 border border-[#1cac64]/8 text-xs font-medium">
                      <div>
                        <span className="text-[9px] text-[#6b9b7a] block uppercase tracking-wider">Active Drops</span>
                        <span className="text-[#1a3a2a] font-bold block mt-0.5">
                          {stats.count} {stats.count === 1 ? "Pack" : "Packs"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[9px] text-[#6b9b7a] block uppercase tracking-wider">Pricing</span>
                        <span className="text-[#1cac64] font-bold block mt-0.5 truncate" title={priceDisplay}>
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
                        className="w-full py-3 rounded-xl bg-[#1cac64]/5 hover:bg-[#1cac64] hover:text-white border border-[#1cac64]/15 hover:border-transparent text-[#1a3a2a] font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer"
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

        {/* ── PRICING SECTION ── */}
        <div id="pricing" className="space-y-8 pt-12 border-t border-white/[0.06]">
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center gap-2.5">
              <div className="h-2 w-2 rounded-full bg-[#1cac64] animate-pulse" />
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[#1cac64]">
                Pricing Plans
              </h2>
            </div>
            <h3 className="text-3xl md:text-4xl font-black text-[#1a3a2a]">
              Choose the Plan for Your Project
            </h3>
            <p className="text-sm text-[#3d6b4e] max-w-xl mx-auto leading-relaxed">
              Launch your custom mystery box drops with rates tailored to your scale. Upgrade anytime as your project expands.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto pt-4">
            {/* Basic / Free Plan */}
            <motion.div
              whileHover={{ y: -6 }}
              className="relative flex flex-col justify-between glass-panel rounded-3xl p-8 border border-[#1cac64]/10 hover:border-[#1cac64]/25 transition-all"
            >
              <div className="space-y-6">
                <div>
                  <h4 className="text-lg font-bold text-[#1a3a2a]">Basic</h4>
                  <p className="text-xs text-[#6b9b7a] mt-1">For new projects starting out</p>
                </div>
                <div className="flex items-baseline gap-1 text-[#1a3a2a]">
                  <span className="text-4xl font-black">Free</span>
                </div>
                <hr className="border-[#1cac64]/10" />
                <ul className="space-y-3.5 text-xs text-[#3d6b4e]">
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span>Platform Fee: <strong>0.0035 SOL</strong> / box open</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span>Unlimited Mystery Packs</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span>Standard Odds System</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span>Public Directory Listing</span>
                  </li>
                </ul>
              </div>
              <div className="pt-8">
                <Link href="/admin/new?package=free">
                  <button className="w-full py-3 rounded-xl bg-[#1cac64]/5 border border-[#1cac64]/15 hover:bg-[#1cac64]/10 text-[#1a3a2a] font-bold text-xs uppercase tracking-wider transition-all cursor-pointer">
                    Get Started Free
                  </button>
                </Link>
              </div>
            </motion.div>

            {/* Pro Plan */}
            <motion.div
              whileHover={{ y: -6 }}
              className="relative flex flex-col justify-between glass-panel rounded-3xl p-8 border border-[#1cac64]/30 hover:border-[#1cac64]/60 shadow-[0_0_30px_rgba(28,172,100,0.06)] bg-gradient-to-b from-[#1cac64]/5 to-transparent"
            >
              <div className="absolute top-4 right-4">
                <span className="text-[9px] px-2.5 py-1 rounded-full bg-[#1cac64]/10 text-[#1cac64] border border-[#1cac64]/20 font-bold uppercase tracking-wider">
                  Popular
                </span>
              </div>
              <div className="space-y-6">
                <div>
                  <h4 className="text-lg font-bold text-[#1cac64]">Pro</h4>
                  <p className="text-xs text-[#3d6b4e] mt-1 font-medium">For growing projects & launches</p>
                </div>
                <div className="flex items-baseline gap-1 text-[#1a3a2a]">
                  <span className="text-4xl font-black">1 SOL</span>
                  <span className="text-xs text-[#6b9b7a] font-medium">/ lifetime</span>
                </div>
                <hr className="border-[#1cac64]/10" />
                <ul className="space-y-3.5 text-xs text-[#3d6b4e]">
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✦</span>
                    <span>Platform Fee: <strong>0.0025 SOL</strong> / box open</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span><strong>Live Draw Discord Bot</strong> Integration</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span>Custom Branding & Theme Colors</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span>Priority Directory Placement</span>
                  </li>
                </ul>
              </div>
              <div className="pt-8">
                <Link href="/admin/new?package=pro">
                  <button className="w-full py-3 rounded-xl bg-[#1cac64] hover:shadow-[0_0_20px_rgba(28,172,100,0.3)] text-white font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer">
                    Upgrade to Pro
                  </button>
                </Link>
              </div>
            </motion.div>

            {/* Enterprise Plan */}
            <motion.div
              whileHover={{ y: -6 }}
              className="relative flex flex-col justify-between glass-panel rounded-3xl p-8 border border-[#1cac64]/10 hover:border-[#1cac64]/25 transition-all"
            >
              <div className="space-y-6">
                <div>
                  <h4 className="text-lg font-bold text-[#1a3a2a]">Enterprise</h4>
                  <p className="text-xs text-[#6b9b7a] mt-1">For high-volume drops & teams</p>
                </div>
                <div className="flex items-baseline gap-1 text-[#1a3a2a]">
                  <span className="text-4xl font-black">4 SOL</span>
                  <span className="text-xs text-[#6b9b7a] font-medium">/ lifetime</span>
                </div>
                <hr className="border-[#1cac64]/10" />
                <ul className="space-y-3.5 text-xs text-[#3d6b4e]">
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span>Platform Fee: <strong>Custom (50% Split)</strong></span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span><strong>Live Draw Discord Bot</strong> Integration</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span>Dedicated Creator Support</span>
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="text-[#1cac64] text-sm">✓</span>
                    <span>API Access & Webhook Integrations</span>
                  </li>
                </ul>
              </div>
              <div className="pt-8">
                <Link href="/admin/new?package=enterprise">
                  <button className="w-full py-3 rounded-xl bg-[#1cac64]/5 border border-[#1cac64]/15 hover:bg-[#1cac64]/10 text-[#1a3a2a] font-bold text-xs uppercase tracking-wider transition-all cursor-pointer">
                    Select Enterprise
                  </button>
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-[#1cac64]/10 mt-16 pt-8 pb-4">
        <div className="mx-auto max-w-[1440px] px-4 lg:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-base font-black">
              <span className="text-[#1cac64]">Geck</span><span className="text-[#1a3a2a]/50">ura</span>
            </span>
            <span className="text-xs text-[#6b9b7a]">© 2026 Geckura. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-[#3d6b4e]">
            <a href="#" className="hover:text-[#1cac64] transition-colors">Docs</a>
            <a href="#" className="hover:text-[#1cac64] transition-colors">Blog</a>
            <a href="#" className="hover:text-[#1cac64] transition-colors">Twitter</a>
            <a href="#" className="hover:text-[#1cac64] transition-colors">Discord</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
