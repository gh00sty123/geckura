"use client";

import { useState, useEffect } from "react";
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
  const PRIMARY_FEE_WALLET = "FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq";
  const SECONDARY_FEE_WALLET = "9xQeQCtdv4URZ9wTnv2N31A3S6d85s1D4x9gZtLrtg52";

  const [feeWalletType, setFeeWalletType] = useState("primary");
  const [feeWallet, setFeeWallet] = useState(PRIMARY_FEE_WALLET);
  const [feeLamports, setFeeLamports] = useState("0");
  const [solRankingPoints, setSolRankingPoints] = useState("2");
  const [tokenRankingPoints, setTokenRankingPoints] = useState("1");
  const [rentClaimMode, setRentClaimMode] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedPackage, setSelectedPackage] = useState("free");

  // Read preselected package from query params safely on client mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const pkg = params.get("package");
      if (pkg === "free" || pkg === "pro" || pkg === "enterprise") {
        setSelectedPackage(pkg);
      }
    }
  }, []);

  const isAdmin = wallet.publicKey?.toBase58() === "FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq";

  // Pre-fill Admin Wallet with connected wallet for creators
  useEffect(() => {
    if (wallet.publicKey && !adminWallet) {
      setAdminWallet(wallet.publicKey.toBase58());
    }
  }, [wallet.publicKey, adminWallet]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setSubmitting(true);
    setError(null);

    if (isAdmin) {
      // Direct on-chain creation by platform administrator
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
    } else {
      // Creator project request submission via Discord
      try {
        const formattedMsg = `
==============================================
GECKURA BOX - NEW PROJECT LAUNCH REQUEST
==============================================
Package Tier: ${selectedPackage.toUpperCase()}
Project Name: ${name}
Slug (URL Path): /${slug}
Description: ${description}
Logo URL: ${logoUri || "Not Provided"}
Banner URL: ${bgUri || "Not Provided"}
Creator Admin Wallet: ${adminWallet}
Theme Color Accent: ${themeColor}
==============================================
        `.trim();

        await navigator.clipboard.writeText(formattedMsg);
        toast.success("Project request copied to clipboard!");
        
        toast((t) => (
          <span className="text-xs text-gray-200">
            Opening Discord Support. Paste your copied project request in the chat!
          </span>
        ), { duration: 4500, icon: "💬" });

        setTimeout(() => {
          window.open("https://discord.gg/geckura", "_blank");
          setSubmitting(false);
        }, 1500);
      } catch (err) {
        setError("Could not automatically copy request to clipboard. Please select and copy manually.");
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">{isAdmin ? "Admin: Deploy Project" : "Configure Project Request"}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isAdmin 
              ? "Instantly initialize a project on-chain." 
              : "Set up your project details to submit your launch request."
            }
          </p>
        </div>
        <Link href="/" className="text-sm text-gray-400 hover:text-white transition">
          ← Back
        </Link>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Selected Package Tier */}
        <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Plan Selected</h3>
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-1">Package Tier</label>
            <select
              value={selectedPackage}
              onChange={(e) => setSelectedPackage(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white cursor-pointer"
            >
              <option value="free">Basic (Free)</option>
              <option value="pro">Pro (1 SOL)</option>
              <option value="enterprise">Enterprise (4 SOL)</option>
            </select>
          </div>
        </div>

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
              label="Logo Image (IPFS/URL)" 
              value={logoUri} 
              onChange={setLogoUri} 
            />

            <ImageUpload 
              label="Background Banner Image (IPFS/URL)" 
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

        {/* Admin Wallet configuration */}
        <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Creator Authority</h3>
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-xs text-gray-500 uppercase">Creator Admin Wallet (authority over drops)</label>
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
        </div>

        {/* Fees & Platform Config (Only visible to the platform administrator) */}
        {isAdmin && (
          <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-6 space-y-6">
            <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Platform & Fees Configuration (Admin Only)</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 uppercase mb-1.5 font-bold">Platform Fee Wallet Selection</label>
                <select
                  value={feeWalletType}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFeeWalletType(val);
                    if (val === "primary") {
                      setFeeWallet(PRIMARY_FEE_WALLET);
                    } else if (val === "secondary") {
                      setFeeWallet(SECONDARY_FEE_WALLET);
                    }
                  }}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white cursor-pointer mb-3.5"
                >
                  <option value="primary">Primary Fee Wallet (FBPFAtDx...Kscq)</option>
                  <option value="secondary">Secondary Fee Wallet (9xQeQC...tg52)</option>
                  <option value="custom">Custom Wallet Address</option>
                </select>

                {feeWalletType === "custom" && (
                  <div className="space-y-1.5 animate-fadeIn">
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs text-gray-500 uppercase">Custom Platform Fee Wallet</label>
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
                )}
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
        )}

        {/* Leaderboard Config (Only visible to the platform administrator) */}
        {isAdmin && (
          <div className="bg-gray-900/60 border border-gray-800/80 rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Leaderboard Points (Admin Only)</h3>
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
        )}

        {/* Submit */}
        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={submitting}
            className={`px-6 py-3 rounded-xl text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer ${
              isAdmin 
                ? "bg-purple-600 hover:bg-purple-700" 
                : "bg-gradient-to-r from-[#39ff14] to-emerald-500 !text-black font-extrabold shadow-[0_0_20px_rgba(57,255,20,0.2)] hover:shadow-[0_0_30px_rgba(57,255,20,0.4)]"
            }`}
          >
            {submitting ? (
              "Processing..."
            ) : isAdmin ? (
              "Deploy Project On-Chain"
            ) : (
              "Copy Request & Continue to Discord"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
