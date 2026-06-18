"use client";

import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import toast from "react-hot-toast";
import { updateProjectBrandingTx } from "@/lib/actions";
import { getSolanaErrorDetails } from "@/lib/program-ix";
import { ImageUpload } from "@/components/ImageUpload";

interface ProjectBrandingModalProps {
  slug: string;
  slugProj: any;
  onClose: () => void;
  onRefresh: () => void;
}

export function ProjectBrandingModal({
  slug,
  slugProj,
  onClose,
  onRefresh,
}: ProjectBrandingModalProps) {
  const wallet = useWallet();
  const [name, setName] = useState(slugProj?.name || "");
  const [logoUri, setLogoUri] = useState(slugProj?.logoUri || "");
  const [bgUri, setBgUri] = useState(slugProj?.bgUri || "");
  const [description, setDescription] = useState(slugProj?.description || "");
  const [themeColor, setThemeColor] = useState(slugProj?.themeColor || "#1cac64");
  const [solRankingPoints, setSolRankingPoints] = useState(String(slugProj?.solRankingPoints ?? "2"));
  const [tokenRankingPoints, setTokenRankingPoints] = useState(String(slugProj?.tokenRankingPoints ?? "1"));
  const [nothingRewardImage, setNothingRewardImage] = useState(slugProj?.nothingRewardImage || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.publicKey) {
      toast.error("Connect wallet first!");
      return;
    }

    setIsSubmitting(true);
    toast.loading("Updating branding...", { id: "branding" });

    try {
      await updateProjectBrandingTx(wallet, {
        slug,
        name,
        logoUri,
        bgUri,
        description,
        themeColor,
        solRankingPoints: parseInt(solRankingPoints),
        tokenRankingPoints: parseInt(tokenRankingPoints),
        nothingRewardImage,
      });
      toast.success("Project branding updated successfully!", { id: "branding" });
      onRefresh();
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(getSolanaErrorDetails(err), { id: "branding" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-[#2d5a3f] hover:text-[#0f2618] transition-colors p-2 bg-[#1cac64]/8 rounded-full hover:bg-white/10"
        >
          ✕
        </button>

        <h2 className="text-2xl font-black text-[#0f2618] mb-6 uppercase tracking-wider flex items-center gap-2">
          Update Project Branding
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-[#2d5a3f] uppercase tracking-wider mb-2">Project Slug</label>
            <input
              type="text"
              disabled
              value={slug}
              className="w-full bg-black/60 border border-white/5 rounded-xl px-4 py-3 text-sm text-[#3d6b4e] cursor-not-allowed font-mono"
            />
            <p className="text-[10px] text-[#3d6b4e] mt-1">The slug is permanent and acts as the project's unique blockchain identifier.</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#2d5a3f] uppercase tracking-wider mb-2">Project Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-4 py-3 text-sm text-[#0f2618] placeholder-[#6b9b7a] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
              placeholder="Awesome Mystery Boxes"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#2d5a3f] uppercase tracking-wider mb-2">Project Description</label>
            <textarea
              required
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-4 py-3 text-sm text-[#0f2618] placeholder-[#6b9b7a] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all resize-none h-24"
              placeholder="Describe your project..."
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#2d5a3f] uppercase tracking-wider mb-2">Logo Upload</label>
            <div className="p-3 bg-[#ffffff]/40 border border-white/5 rounded-xl">
              <ImageUpload
                label="Logo"
                onChange={(url: string) => setLogoUri(url)}
                value={logoUri}
              />
            </div>
            <p className="text-[10px] text-[#3d6b4e] mt-1">Recommended size: 200x200px. Upload an image to preview.</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#2d5a3f] uppercase tracking-wider mb-2">Background Banner Upload</label>
            <div className="p-3 bg-[#ffffff]/40 border border-white/5 rounded-xl">
              <ImageUpload
                label="Background"
                onChange={(url: string) => setBgUri(url)}
                value={bgUri}
              />
            </div>
            <p className="text-[10px] text-[#3d6b4e] mt-1">Recommended size: 1200x400px.</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#2d5a3f] uppercase tracking-wider mb-2">Theme Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={themeColor}
                onChange={e => setThemeColor(e.target.value)}
                className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border-0 p-0"
              />
              <input
                type="text"
                required
                value={themeColor}
                onChange={e => setThemeColor(e.target.value)}
                className="flex-1 bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-4 py-3 text-sm text-[#0f2618] placeholder-[#6b9b7a] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all font-mono"
                placeholder="#1cac64"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#2d5a3f] uppercase tracking-wider mb-2">
              &quot;Nothing&quot; Reward Visual Option
            </label>
            <div className="grid grid-cols-2 gap-3 mb-3">
              {/* Preset 1: Empty Chest */}
              <button
                type="button"
                onClick={() => setNothingRewardImage("/nothing.png")}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all bg-[#ebfde3]/60 hover:bg-black/60 ${
                  nothingRewardImage === "/nothing.png"
                    ? "border-[#1cac64] shadow-[0_0_15px_rgba(28,172,100,0.2)] text-[#0f2618]"
                    : "border-[#1cac64]/15 text-[#2d5a3f]"
                }`}
              >
                <div className="h-12 w-12 rounded-lg overflow-hidden border border-[#1cac64]/15 mb-2 flex items-center justify-center bg-black/60">
                  <img src="/nothing.png" alt="Try Again Chest" className="w-full h-full object-cover" />
                </div>
                <span className="text-xs font-bold">Neon Empty Chest</span>
              </button>

              {/* Preset 2: Default Gift Box */}
              <button
                type="button"
                onClick={() => setNothingRewardImage("🎁")}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all bg-[#ebfde3]/60 hover:bg-black/60 ${
                  nothingRewardImage === "🎁" || !nothingRewardImage
                    ? "border-[#1cac64] shadow-[0_0_15px_rgba(28,172,100,0.2)] text-[#0f2618]"
                    : "border-[#1cac64]/15 text-[#2d5a3f]"
                }`}
              >
                <div className="h-12 w-12 rounded-lg border border-[#1cac64]/15 mb-2 flex items-center justify-center bg-black/60 text-2xl">
                  🎁
                </div>
                <span className="text-xs font-bold">Default Gift Box</span>
              </button>
            </div>

            {/* Custom option */}
            <div className="p-3 bg-[#ffffff]/40 border border-white/5 rounded-xl">
              <ImageUpload
                label="Or Upload Custom 'Nothing' Image"
                onChange={(url: string) => setNothingRewardImage(url)}
                value={nothingRewardImage !== "/nothing.png" && nothingRewardImage !== "🎁" ? nothingRewardImage : ""}
              />
            </div>
            <p className="text-[10px] text-[#3d6b4e] mt-1">This image will represent zero-value rewards (Try again / empty boxes) during pack openings.</p>
          </div>

          <div className="bg-[#1cac64]/8 border border-[#1cac64]/15 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#1a3a2a] uppercase tracking-wider">Leaderboard Points Configuration</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#2d5a3f] uppercase tracking-wider mb-2">Points per SOL Box</label>
                <input
                  type="number"
                  required
                  min="0"
                  value={solRankingPoints}
                  onChange={e => setSolRankingPoints(e.target.value)}
                  className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-4 py-3 text-sm text-[#0f2618] placeholder-[#6b9b7a] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all font-mono"
                  placeholder="2"
                />
                <p className="text-[10px] text-[#3d6b4e] mt-1">Points awarded for opening a SOL box</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#2d5a3f] uppercase tracking-wider mb-2">Points per Token Box</label>
                <input
                  type="number"
                  required
                  min="0"
                  value={tokenRankingPoints}
                  onChange={e => setTokenRankingPoints(e.target.value)}
                  className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-4 py-3 text-sm text-[#0f2618] placeholder-[#6b9b7a] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all font-mono"
                  placeholder="1"
                />
                <p className="text-[10px] text-[#3d6b4e] mt-1">Points awarded for opening a token box</p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl font-bold uppercase tracking-wider text-sm bg-[#1cac64]/8 text-[#1a3a2a] hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 rounded-xl font-bold uppercase tracking-wider text-sm bg-gradient-to-r from-emerald-500 to-teal-500 text-[#0f2618] hover:from-emerald-400 hover:to-teal-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Updating...
                </>
              ) : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
