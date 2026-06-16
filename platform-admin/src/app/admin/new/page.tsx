"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createProjectTx } from "@/lib/actions";
import { getSolanaErrorDetails } from "@/lib/program-ix";
import toast from "react-hot-toast";
import { ImageUpload } from "@/components/ImageUpload";

export default function NewProjectPage() {
  const wallet = useWallet();
  const router = useRouter();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [logoUri, setLogoUri] = useState("");
  const [bgUri, setBgUri] = useState("");
  const [themeColor, setThemeColor] = useState("#39ff14");
  const [adminWallet, setAdminWallet] = useState("");
  const [feeWallet, setFeeWallet] = useState("");
  const [feeLamports, setFeeLamports] = useState("0");
  const [solRankingPoints, setSolRankingPoints] = useState("2");
  const [tokenRankingPoints, setTokenRankingPoints] = useState("1");
  const [rentClaimMode, setRentClaimMode] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.publicKey) return;

    setSubmitting(true);
    setError(null);

    try {
      const feeSol = parseFloat(feeLamports);
      if (isNaN(feeSol) || feeSol < 0) {
        throw new Error("Fee must be a non-negative number");
      }
      const feeLamportsValue = Math.round(feeSol * 1e9);

      const solPoints = parseInt(solRankingPoints);
      if (isNaN(solPoints) || solPoints < 0) {
        throw new Error("SOL ranking points must be a non-negative number");
      }

      const tokenPoints = parseInt(tokenRankingPoints);
      if (isNaN(tokenPoints) || tokenPoints < 0) {
        throw new Error("Token ranking points must be a non-negative number");
      }

      await createProjectTx(wallet, {
        slug,
        authority: new PublicKey(adminWallet),
        feeWallet: new PublicKey(feeWallet),
        feeLamports: feeLamportsValue,
        solRankingPoints: solPoints,
        tokenRankingPoints: tokenPoints,
        rentClaimMode: parseInt(rentClaimMode),
      });

      if (typeof window !== "undefined") {
        localStorage.setItem(
          `project_branding_${slug}`,
          JSON.stringify({
            name: name || slug,
            description,
            logoUri,
            bgUri,
            themeColor,
          })
        );
      }

      toast.success("Project created successfully!");
      router.push("/admin");
    } catch (err: any) {
      const errorMsg = getSolanaErrorDetails(err);
      setError(errorMsg);
      if (errorMsg.includes("cancelled") || errorMsg.includes("rejected")) {
        toast.error("Transaction cancelled");
      } else {
        toast.error("Failed to create project");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!wallet.connected) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 text-center">
        <p className="text-gray-500">Connect your wallet to create a project.</p>
      </div>
    );
  }

  if (wallet.publicKey?.toBase58() !== "FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq") {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 text-center">
        <p className="text-red-400 font-bold">Access Denied. Only the platform admin wallet (FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq) is authorized to create projects.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Create New Project</h1>
          <p className="text-sm text-gray-500 mt-1">Set up your mystery box project</p>
        </div>
        <Link href="/admin" className="text-sm text-gray-400 hover:text-white transition">
          ← Back
        </Link>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Basic Information</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Project Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600"
                placeholder="Awesome Mystery Boxes"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Slug (URL friendly)</label>
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 font-mono"
                placeholder="awesome-boxes"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Description</label>
              <textarea
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 min-h-24"
                placeholder="Tell us about your project..."
              />
            </div>
          </div>
        </div>

        {/* Branding */}
        <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Branding</h3>

          <div className="space-y-4">
            <ImageUpload 
              label="Logo Image" 
              value={logoUri} 
              onChange={setLogoUri} 
            />

            <ImageUpload 
              label="Background Image" 
              value={bgUri} 
              onChange={setBgUri} 
            />

            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Theme Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className="w-12 h-12 rounded border-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Wallets & Fees</h3>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs text-gray-500 uppercase">Admin Wallet (can manage project, create boxes)</label>
                {wallet.publicKey && (
                  <button
                    type="button"
                    onClick={() => setAdminWallet(wallet.publicKey!.toBase58())}
                    className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                  >
                    Use Connected Wallet
                  </button>
                )}
              </div>
              <input
                type="text"
                required
                value={adminWallet}
                onChange={(e) => setAdminWallet(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 font-mono"
                placeholder="Enter Solana wallet address"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs text-gray-500 uppercase">Platform Fee Wallet (where fees are sent)</label>
                {wallet.publicKey && (
                  <button
                    type="button"
                    onClick={() => setFeeWallet(wallet.publicKey!.toBase58())}
                    className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                  >
                    Use Connected Wallet
                  </button>
                )}
              </div>
              <input
                type="text"
                required
                value={feeWallet}
                onChange={(e) => setFeeWallet(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 font-mono"
                placeholder="Enter Solana wallet address"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Platform Fee (SOL per box opened)</label>
              <input
                type="number"
                required
                min="0"
                step="0.000000001"
                value={feeLamports}
                onChange={(e) => setFeeLamports(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white"
                placeholder="0.001"
              />
              <p className="text-xs text-gray-500 mt-1">1 SOL = 1,000,000,000 lamports</p>
            </div>

            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">ATA Rent Claim Recipient</label>
              <select
                value={rentClaimMode}
                onChange={(e) => setRentClaimMode(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white cursor-pointer"
              >
                <option value="0">Project Authority (Default)</option>
                <option value="1">Platform Treasury</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Determines who receives the reclaimed Solana rent (~0.002 SOL) when vault Associated Token Accounts are closed.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Leaderboard Points</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Points per SOL Box Open</label>
              <input
                type="number"
                required
                min="0"
                value={solRankingPoints}
                onChange={(e) => setSolRankingPoints(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600"
                placeholder="2"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 uppercase mb-1">Points per Token Box Open</label>
              <input
                type="number"
                required
                min="0"
                value={tokenRankingPoints}
                onChange={(e) => setTokenRankingPoints(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600"
                placeholder="1"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-3 bg-purple-600 rounded-lg text-sm font-semibold hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating..." : "Create Project"}
          </button>
        </div>
      </form>
    </div>
  );
}
