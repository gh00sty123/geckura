"use client";

import { useState, useRef, useEffect, useSyncExternalStore, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import {
  FiBell, FiChevronDown,
  FiCopy, FiExternalLink, FiLogOut, FiCreditCard, FiAward, FiPackage, FiGift,
} from "react-icons/fi";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useProjectBranding } from "@/lib/ProjectBrandingProvider";
import Image from "next/image";
import { Connection } from "@solana/web3.js";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useAppStore, type Notification } from "@/lib/store";

const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const EXPLORER_BASE = "https://explorer.solana.com/address";
const CLUSTER_PARAM = RPC.includes("devnet") ? "?cluster=devnet" : RPC.includes("mainnet") ? "" : "?cluster=devnet";

export default function Navbar({
  balance: propBalance,
}: {
  balance?: string;
}) {
  const branding = useProjectBranding();
  const params = useParams();
  const pathname = usePathname();
  const slug = (params?.slug as string) || "geckurabox";
  const isAdminPage = pathname?.includes("/admin") ?? false;

  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen]     = useState(false);
  const [solBalance, setSolBalance]   = useState<string | null>(propBalance ?? null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef   = useRef<HTMLDivElement>(null);

  const { 
    notifications, 
    addNotification, 
    markNotificationRead, 
    clearAllNotifications 
  } = useAppStore();

  const formatTimeAgo = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hr ago`;
    return `${Math.floor(hours / 24)} days ago`;
  };

  const getNotificationIcon = (type: Notification["type"]) => {
    switch (type) {
      case "win":
        return <FiAward className="text-amber-400" />;
      case "new_pack":
        return <FiPackage className="text-blue-400" />;
      case "daily_reward":
        return <FiGift className="text-theme" />;
      default:
        return <FiBell className="text-gray-400" />;
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  const wallet = useWallet();
  const { disconnect, publicKey, connected } = wallet;

  const walletAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : null;

  const fullAddress = publicKey?.toBase58() ?? "";

  /**
   * WalletMultiButton must NOT render on the server — it relies on
   * the wallet-adapter context which is unavailable at SSR time.
   */
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  /* ── Fetch SOL balance when wallet connects ── */
  useEffect(() => {
    if (!publicKey) { setSolBalance(null); return; }
    const conn = new Connection(RPC, "confirmed");
    let cancelled = false;
    conn.getBalance(publicKey).then(lamports => {
      if (!cancelled) setSolBalance((lamports / 1e9).toFixed(4));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [publicKey]);

  const handleDisconnect = useCallback(async () => {
    try { await disconnect(); } catch { toast.dismiss(); }
    setProfileOpen(false);
  }, [disconnect]);

  const handleCopyAddress = async () => {
    if (!publicKey) return;
    await navigator.clipboard.writeText(fullAddress);
    toast.success("Address copied!");
  };

  const handleViewExplorer = () => {
    if (!publicKey) return;
    window.open(`${EXPLORER_BASE}/${fullAddress}${CLUSTER_PARAM}`, "_blank");
    setProfileOpen(false);
  };

  /* ── Load personalized notifications when wallet connects ── */
  useEffect(() => {
    if (publicKey && notifications.length === 0) {
      // Add sample personalized notifications - in production, these would come from your backend/on-chain events
      const sampleNotifications: Omit<Notification, "id" | "read">[] = [
        {
          type: "win",
          message: "You won a Legendary NFT!",
          timestamp: Date.now() - 120000, // 2 min ago
        },
        {
          type: "new_pack",
          message: "New pack drop just live",
          timestamp: Date.now() - 3600000, // 1 hr ago
        },
        {
          type: "daily_reward",
          message: "Daily reward ready",
          timestamp: Date.now() - 10800000, // 3 hrs ago
        },
      ];

      // Add sample notifications
      sampleNotifications.forEach((n, i) => {
        setTimeout(() => addNotification(n), i * 100);
      });
    }
  }, [publicKey, addNotification, notifications.length]);

  /* ── Close dropdowns on outside click ── */
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node))     setNotifOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const themeColor = branding.themeColor || "#39ff14";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --theme-color: ${themeColor};
        }
        .hover-theme-border:hover {
          border-color: ${themeColor}33 !important;
        }
        .theme-avatar-gradient {
          background: linear-gradient(135deg, ${themeColor}, #059669) !important;
          color: #0a0a0a !important;
          box-shadow: 0 0 12px ${themeColor}40 !important;
        }
        .text-theme {
          color: ${themeColor} !important;
        }
        .text-theme-muted {
          color: ${themeColor}b3 !important;
        }
        .bg-theme-tint {
          background-color: ${themeColor}10 !important;
          border-color: ${themeColor}26 !important;
        }
        .theme-gradient-header {
          background: linear-gradient(135deg, ${themeColor}0d, transparent) !important;
        }
        .hover-theme-glow:hover {
          color: ${themeColor} !important;
          text-shadow: 0 0 12px ${themeColor}40 !important;
        }
        .text-theme-glow {
          color: ${themeColor} !important;
          text-shadow: 0 0 12px ${themeColor}40 !important;
        }
      `}} />
      <nav className="sticky top-0 z-50 h-[68px] border-b border-white/[0.06] bg-[#0a0a0a]/75 backdrop-blur-2xl glass-panel">
        <div className="mx-auto max-w-[1440px] h-full px-4 lg:px-6 flex items-center justify-between gap-3">

          {/* ── Logo / Project branding ── */}
          <Link href={slug === "geckurabox" ? "/" : `/${slug}`} className="flex items-center gap-2.5 shrink-0 cursor-pointer hover:opacity-90 transition-opacity">
            {branding.logoUrl ? (
              <>
                <Image
                  src={branding.logoUrl}
                  alt={branding.name}
                  width={32}
                  height={32}
                  className="rounded-full"
                  unoptimized
                />
                <span className="hidden sm:inline text-sm font-semibold text-white">
                  {branding.name}
                </span>
              </>
            ) : slug !== "geckurabox" ? (
              <>
                <span className="relative inline-flex">
                  <span className="absolute -inset-1 rounded-full blur-md" style={{ backgroundColor: `${themeColor}26` }} />
                  <span className="relative text-[20px] tracking-tight leading-none font-bold select-none text-white">
                    {branding.name}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="relative inline-flex">
                  <span className="absolute -inset-1 rounded-full blur-md" style={{ backgroundColor: `${themeColor}26` }} />
                  <span className="relative text-[22px] tracking-tight leading-none font-bold select-none">
                    <span style={{ color: themeColor }}>Geck</span>
                    <span className="text-white/80">ura</span>
                  </span>
                </span>
                <span 
                  className="hidden sm:inline text-[10px] font-semibold tracking-[0.18em] uppercase rounded-full px-2 py-0.5"
                  style={{ 
                    color: `${themeColor}b3`, 
                    borderColor: `${themeColor}40`,
                    borderWidth: "1px",
                    borderStyle: "solid"
                  }}
                >
                  Box
                </span>
              </>
            )}
          </Link>

          {/* ── Spacer (left) ── */}
          <div className="flex-1" />

          {/* ── Navigation Links (CENTERED!) ── */}
          {!isAdminPage ? (
            <div className="flex items-center gap-6">
              <Link
                href={slug === "geckurabox" ? "/" : `/${slug}`}
                className={`text-xs sm:text-sm font-bold uppercase tracking-wider transition-all hover-theme-glow ${
                  pathname === `/${slug}` || pathname === "/" ? "text-theme-glow" : "text-gray-400"
                }`}
              >
                Packs
              </Link>
              <Link
                href={`/${slug}/leaderboard`}
                className={`text-xs sm:text-sm font-bold uppercase tracking-wider transition-all hover-theme-glow ${
                  pathname?.includes("/leaderboard") ? "text-theme-glow" : "text-gray-400"
                }`}
              >
                Leaderboard
              </Link>
            </div>
          ) : (
            pathname !== "/admin" && (
              <div className="flex items-center gap-6">
                {pathname.endsWith("/admin") ? (
                  <>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('open-project-branding'))}
                      className="text-xs sm:text-sm font-bold uppercase tracking-wider text-gray-400 hover-theme-glow transition-all"
                    >
                      Branding
                    </button>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('open-vault-manager'))}
                      className="text-xs sm:text-sm font-bold uppercase tracking-wider text-gray-400 hover-theme-glow transition-all"
                    >
                      Vault Manager
                    </button>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('open-create-box'))}
                      className="text-xs sm:text-sm font-bold uppercase tracking-wider text-gray-400 hover-theme-glow transition-all"
                    >
                      Create Box
                    </button>
                  </>
                ) : (
                  <Link
                    href={`/${slug}/admin`}
                    className={`text-xs sm:text-sm font-bold uppercase tracking-wider transition-all hover-theme-glow ${
                      pathname?.endsWith("/admin") ? "text-theme-glow" : "text-gray-400"
                    }`}
                  >
                    Back to Admin
                  </Link>
                )}
                <Link
                  href={`/${slug}/admin/leaderboard`}
                  className={`text-xs sm:text-sm font-bold uppercase tracking-wider transition-all hover-theme-glow ${
                    pathname?.includes("/admin/leaderboard") ? "text-theme-glow" : "text-gray-400"
                  }`}
                >
                  Leaderboard
                </Link>
              </div>
            )
          )}

          {/* ── Spacer (right) ── */}
          <div className="flex-1" />



          {/* ══════════════════════════════════════════════════════
             UNIFIED PROFILE + WALLET BUTTON
             One button: avatar, address, balance, dropdown.
          ══════════════════════════════════════════════════════ */}
          {connected && walletAddress ? (
            <div className="relative" ref={profileRef}>
              <motion.button
                onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false); }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-2xl bg-white/[0.04] border border-white/[0.08]
                  hover:bg-white/[0.07] hover-theme-border transition-all cursor-pointer"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                {/* Avatar */}
                <div className="h-8 w-8 rounded-full flex items-center justify-center
                  text-[13px] font-black shrink-0 theme-avatar-gradient">
                  {fullAddress ? fullAddress.slice(0, 1).toUpperCase() : "G"}
                </div>

                {/* Address + Balance */}
                <div className="hidden sm:flex flex-col items-start leading-none">
                  <span className="text-xs font-semibold text-gray-200">{walletAddress}</span>
                  {solBalance && (
                    <span className="text-[10px] font-mono text-theme-muted mt-0.5">◎ {solBalance} SOL</span>
                  )}
                </div>

                <FiChevronDown className={`text-xs text-gray-500 transition-transform duration-200 ml-0.5 ${profileOpen ? "rotate-180" : ""}`} />
              </motion.button>

              {/* ── Profile Dropdown ── */}
              <AnimatePresence>
                {profileOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    className="absolute right-0 top-[calc(100%+8px)] w-72 glass-panel-lg rounded-2xl overflow-hidden shadow-2xl"
                  >
                    {/* Header card */}
                    <div className="p-4 theme-gradient-header border-b border-white/[0.06]">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 rounded-full flex items-center justify-center
                          text-[17px] font-black shrink-0 theme-avatar-gradient">
                          {fullAddress ? fullAddress.slice(0, 1).toUpperCase() : "G"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{walletAddress}</p>
                          <p className="text-[10px] text-gray-500 font-mono truncate mt-0.5">{fullAddress}</p>
                        </div>
                      </div>

                      {/* Balance card */}
                      {solBalance && (
                        <div className="mt-3 flex items-center gap-2 p-2.5 rounded-xl bg-theme-tint border">
                          <FiCreditCard className="text-theme text-sm shrink-0" />
                          <span className="text-sm font-bold text-theme font-mono">◎ {solBalance}</span>
                          <span className="text-[10px] text-theme-muted font-semibold">SOL</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="p-1.5">
                      <button
                        onClick={handleCopyAddress}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs text-gray-300
                          hover:text-white hover:bg-white/[0.04] transition-colors cursor-pointer"
                      >
                        <FiCopy className="text-sm text-gray-500" />
                        Copy Address
                      </button>
                      <button
                        onClick={handleViewExplorer}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs text-gray-300
                          hover:text-white hover:bg-white/[0.04] transition-colors cursor-pointer"
                      >
                        <FiExternalLink className="text-sm text-gray-500" />
                        View on Explorer
                      </button>

                      {/* Divider */}
                      <div className="h-px bg-white/[0.06] my-1" />

                      <button
                        onClick={handleDisconnect}
                        className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs text-red-400
                          hover:bg-red-500/10 transition-colors cursor-pointer"
                      >
                        <FiLogOut className="text-sm" />
                        Disconnect Wallet
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : mounted ? (
            <WalletMultiButton />
          ) : (
            <button
              className="wallet-adapter-button wallet-adapter-button-trigger"
              disabled
              type="button"
            >
              Select Wallet
            </button>
          )}

        </div>
      </nav>
    </>
  );
}
