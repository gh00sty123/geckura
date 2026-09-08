"use client";

import { Buffer } from "buffer";
if (typeof window !== "undefined" && !window.Buffer) {
  window.Buffer = Buffer;
}
if (typeof globalThis !== "undefined" && !globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

import { useCallback, useEffect, useState, useMemo, useRef, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { PublicKey, Connection, SystemProgram, Transaction, SendTransactionError } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { retryWithBackoff, buildIx, boxStatusToCode, toUnixSeconds, platformPDA, projectPDA, boxPDA, ixOpenBox, ixClaimPrizes, decodeAccount, vaultPDA } from "@/lib/program-ix";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);
import { type LiveBox, useAppStore } from "@/lib/store";
import { useSetProjectBranding, useProjectBranding } from "@/lib/ProjectBrandingProvider";
import { TwitterXIcon } from "@/components/SocialIcons";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createTransferInstruction } from "@solana/spl-token";
import toast from "react-hot-toast";
import { resolveIpfsUrl, updateFavicon } from "@/lib/helpers";
import { BorshAccountsCoder, BorshCoder, BorshEventCoder, EventParser } from "@coral-xyz/anchor";
import IDL from "@/lib/idl.json";

const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "HnysT79HmiJWWtE8W2LWbhBeXk27RxoohbJ4cQyw8AKr");
const RPC  = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const EXPLORER_BASE = "https://explorer.solana.com/tx";
const CLUSTER_PARAM = RPC.includes("devnet") ? "?cluster=devnet" : RPC.includes("mainnet") ? "" : "?cluster=devnet";

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function resolveTokenDetails(mint: string, customMap?: Record<string, { symbol: string; name: string; decimals: number; image: string; isNFT?: boolean }>) {
  if (mint === "11111111111111111111111111111111" || mint === "11111111111111111111111111111111") {
    return { symbol: "SOL", name: "Solana", decimals: 9, image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png", isNFT: false };
  }
  if (mint === "EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v") {
    return { symbol: "USDC", name: "USDC", decimals: 6, image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v/logo.png", isNFT: false };
  }
  if (customMap && customMap[mint]) {
    return customMap[mint];
  }
  return {
    symbol: mint.slice(0, 4) + "..." + mint.slice(-4),
    name: "Custom Token",
    decimals: 9,
    image: "🎁",
    isNFT: false
  };
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4);
}

function timeLeft(ts: number): string {
  const end = toUnixSeconds(ts);
  const diff = end - Math.floor(Date.now() / 1000);
  if (end <= 0 || diff <= 0) return "Ended";
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function shortenSig(sig: string): string {
  return sig.slice(0, 8) + "…" + sig.slice(-6);
}

function Ticker({ items }: { items: string[] }) {
  const doubled = [...items, ...items];
  return (
    <div className="overflow-hidden">
      <div className="ticker-anim flex gap-10 whitespace-nowrap text-xs text-[#2d5a3f]">
        {doubled.map((t, i) => (
          <span key={i} className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1cac64] opacity-70" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#1cac64]" />
            </span>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function parseSolanaError(err: any): string {
  if (err instanceof SendTransactionError) {
    console.error("[SendTransactionError] Detailed Logs:", err.logs);
  } else if (err && typeof err.getLogs === "function") {
    try {
      console.error("[Solana Error] Detailed Logs:", err.logs || (err as any).getLogs?.());
    } catch {}
  }

  const msg = err?.message || "";
  
  // Try to find the Anchor custom error message in transaction logs
  let logs = err?.logs || err?.metadata?.logs || err?.err?.logs || [];
  if ((!logs || logs.length === 0) && err && typeof err.getLogs === "function") {
    try {
      logs = err.getLogs();
    } catch {}
  }
  if (Array.isArray(logs)) {
    for (const log of logs) {
      if (log.includes("Error Message:")) {
        const index = log.indexOf("Error Message:");
        return log.slice(index + "Error Message:".length).trim();
      }
      if (log.includes("Transfer: insufficient lamports") || log.includes("insufficient lamports")) {
        return "Insufficient SOL balance to pay for transaction fees or box price.";
      }
      if (log.includes("insufficient funds for rent") || log.includes("insufficient balance for rent")) {
        return "Insufficient SOL balance for rent-exempt minimum of new accounts.";
      }
    }
  }

  // Fallback regex search within the stringified error object to catch logs if they were printed as string
  const stringified = JSON.stringify(err);
  const match = stringified.match(/Error Message:\s*([^"\\]+)/);
  if (match && match[1]) {
    return match[1].trim();
  }

  if (msg.includes("0x177e") || msg.includes("6014") || msg.includes("InsufficientFunds")) {
    return "Insufficient funds in prize vault or missing prize token account (InsufficientFunds).";
  }
  if (msg.includes("0x1777") || msg.includes("6007")) {
    return "The payment amount is insufficient.";
  }
  if (msg.includes("0x1770") || msg.includes("6000")) {
    return "The signer is not authorized to perform this action.";
  }
  if (msg.includes("0x1771") || msg.includes("6001")) {
    return "The platform is paused.";
  }
  if (msg.includes("0x1772") || msg.includes("6002")) {
    return "The project is inactive.";
  }
  if (msg.includes("0x1773") || msg.includes("6003")) {
    return "The box is not active.";
  }
  if (msg.includes("0x1774") || msg.includes("6004")) {
    return "The box is sold out.";
  }
  if (msg.includes("0x1778") || msg.includes("6008")) {
    return "Invalid prize type configuration.";
  }
  if (msg.includes("0x1779") || msg.includes("6009")) {
    return "Invalid token mint.";
  }
  if (msg.includes("0x177c") || msg.includes("6012")) {
    return "The box has not ended yet.";
  }
  if (msg.includes("0x177d") || msg.includes("6013")) {
    return "This prize has no remaining claims.";
  }
  if (msg.includes("0x1785") || msg.includes("6021")) {
    return "No unopened boxes available to open.";
  }

  if (
    msg.includes("Blockhash not found") ||
    msg.includes("blockhash not found") ||
    msg.includes("BlockhashNotFound") ||
    msg.includes("blockhash")
  ) {
    return "Transaction expired while waiting for wallet confirmation. Please try again and approve the wallet prompt quickly.";
  }

  // Wallet user rejection
  if (msg.includes("User rejected")) {
    return "Transaction signature rejected by user.";
  }

  if (
    msg.includes("disconnected port") ||
    msg.includes("disconnected") ||
    msg.includes("Disconnected")
  ) {
    return "Wallet connection lost. Please reload the page or reconnect your wallet.";
  }
  
  // Native fee balance error
  if (msg.includes("Attempt to debit an account but found no record of a prior credit")) {
    return "Insufficient SOL balance to pay for transaction fees or box price.";
  }
  if (msg.includes("insufficient funds for rent") || msg.includes("insufficient balance for rent")) {
    return "Insufficient SOL balance for rent-exempt minimum of new accounts.";
  }

  return msg || "Transaction failed. Please try again.";
}

export interface AssetInfo {
  ata: string;
  mint: string;
  uiAmount: number;
  decimals: number;
  isNFT: boolean;
  name: string;
  image?: string;
  symbol?: string;
}

// Metaplex Metadata Layout Parser
function parseMetaplexMetadata(data: Buffer | Uint8Array) {
  try {
    if (data.length < 319) return null;
    
    // Metaplex Metadata Data struct byte offsets:
    // 0..1: Key (1 u8)
    // 1..33: Update Authority (32)
    // 33..65: Mint (32)
    // 65..69: Name len (4)
    // 69..101: Name (32)
    // 101..105: Symbol len (4)
    // 105..115: Symbol (10)
    // 115..119: URI len (4)
    // 119..319: URI (200)

    const nameBytes = data.slice(69, 69 + 32);
    const name = new TextDecoder().decode(nameBytes).replace(/\0/g, "").trim();
    
    const symbolBytes = data.slice(105, 105 + 10);
    const symbol = new TextDecoder().decode(symbolBytes).replace(/\0/g, "").trim();
    
    const uriBytes = data.slice(119, 119 + 200);
    let uri = new TextDecoder().decode(uriBytes).replace(/\0/g, "").trim();
    const httpIdx = uri.indexOf("http");
    if (httpIdx > 0) {
      uri = uri.slice(httpIdx);
    } else {
      const ipfsIdx = uri.indexOf("ipfs://");
      if (ipfsIdx > 0) {
        uri = uri.slice(ipfsIdx);
      } else {
        const arIdx = uri.indexOf("ar://");
        if (arIdx > 0) {
          uri = uri.slice(arIdx);
        }
      }
    }
    
    return { name, symbol, uri };
  } catch (e) {
    console.error("Failed to parse Metaplex metadata:", e);
    return null;
  }
}

// Fallback method using standard Solana JSON-RPC methods and on-chain Metaplex Metadata resolution
async function fetchAssetsForOwnerFallback(ownerPk: PublicKey, rpcUrl: string): Promise<AssetInfo[]> {
  const conn = new Connection(rpcUrl, "confirmed");
  const tokenProg = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const token2022Prog = new PublicKey("TokenzQdBNbXtJU34e2qpQX29ZK4555eUBJ1ibh86uLC");
  const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  
  const [tokens, tokens2022] = await Promise.all([
    retryWithBackoff(
      () => conn.getParsedTokenAccountsByOwner(ownerPk, { programId: tokenProg }),
      "getParsedTokenAccountsByOwner(Token)"
    ).catch(() => ({ value: [] })),
    retryWithBackoff(
      () => conn.getParsedTokenAccountsByOwner(ownerPk, { programId: token2022Prog }),
      "getParsedTokenAccountsByOwner(Token-2022)"
    ).catch(() => ({ value: [] }))
  ]);

  const allTokenAccounts = [...tokens.value, ...tokens2022.value];
  
  const parsedPromises = allTokenAccounts.map(async (ta): Promise<AssetInfo | null> => {
    const parsedData = ta.account.data;
    if (!parsedData || typeof parsedData !== 'object' || !('parsed' in parsedData)) {
      return null;
    }
    const info = parsedData.parsed?.info;
    if (!info || !info.tokenAmount) return null;

    const mint = info.mint;
    const uiAmount = info.tokenAmount.uiAmount ?? 0;
    const decimals = info.tokenAmount.decimals ?? 0;
    const isNFT = decimals === 0 && uiAmount === 1;

    let image = "";
    let name = isNFT 
      ? `NFT (${mint.slice(0, 4)}…${mint.slice(-4)})` 
      : mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" 
        ? "USDC" 
        : `Token (${mint.slice(0, 4)}…${mint.slice(-4)})`;

    if (mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
      image = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png";
    } else {
      try {
        const [metadataPk] = PublicKey.findProgramAddressSync(
          [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()],
          METAPLEX_PROGRAM_ID
        );
        const accountInfo = await conn.getAccountInfo(metadataPk);
        if (accountInfo && accountInfo.data) {
          const parsed = parseMetaplexMetadata(accountInfo.data);
          if (parsed && parsed.uri) {
            name = parsed.name || name;
            try {
              const res = await fetch(resolveIpfsUrl(parsed.uri));
              if (res.ok) {
                const json = await res.json();
                image = resolveIpfsUrl(json.image || image);
                if (json.name) name = json.name;
              }
            } catch {}
          }
        }
      } catch {}
    }

    return {
      ata: ta.pubkey.toBase58(),
      mint,
      uiAmount,
      decimals,
      isNFT,
      name,
      image
    };
  });

  const parsed = (await Promise.all(parsedPromises)).filter((t): t is AssetInfo => t !== null && t.uiAmount > 0);
  return parsed;
}

// Fetch method supporting Helius DAS JSON-RPC API with standard RPC fallback
async function fetchAssetsForOwner(ownerPk: PublicKey, rpcUrl: string): Promise<AssetInfo[]> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "helius-das",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: ownerPk.toBase58(),
          page: 1,
          limit: 1000,
          displayOptions: {
            showFungible: true
          }
        }
      })
    });
    
    if (response.ok) {
      const json = await response.json();
      if (!json.error && json.result && json.result.items !== undefined) {
        const items = json.result.items || [];
        const assetPromises = items.map(async (item: any): Promise<AssetInfo> => {
          const mint = item.id;
          const isNFT = item.interface === "Custom" || item.interface === "ProgrammableNFT" || item.interface === "NFT" || item.interface === "V1_NFT";
          
          const content = item.content || {};
          const metadata = content.metadata || {};
          const links = content.links || {};
          let image = content.files?.[0]?.uri || links.image || "";
          
          if (!image && content.json_uri) {
            try {
              const res = await fetch(content.json_uri);
              if (res.ok) {
                const resJson = await res.json();
                image = resJson.image || "";
              }
            } catch {}
          }

          if (!image && mint === "EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v") {
            image = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v/logo.png";
          }
          
          const tokenInfo = item.token_info || {};
          const symbol = tokenInfo.symbol || metadata.symbol || "";
          const name = metadata.name || (isNFT ? `NFT (${mint.slice(0, 4)}…)` : symbol || `Token (${mint.slice(0, 4)}…)`);
          
          const decimals = tokenInfo.decimals ?? 0;
          const uiAmount = tokenInfo.balance ?? 0;

          return {
            ata: "",
            mint,
            uiAmount,
            decimals,
            isNFT,
            name,
            image,
            symbol
          };
        });
        return await Promise.all(assetPromises);
      }
    }
    throw new Error("Helius DAS not supported or failed");
  } catch (e: any) {
    console.warn("Helius DAS fetch failed, falling back to standard RPC:", e);
    return fetchAssetsForOwnerFallback(ownerPk, rpcUrl);
  }
}

// Fetch individual asset metadata via Helius DAS with on-chain Metaplex Metadata fallback
async function fetchAssetMetadata(mint: string, rpcUrl: string): Promise<Partial<AssetInfo>> {
  if (!mint || typeof mint !== "string" || mint.trim() === "") return {};
  let mintPk: PublicKey;
  try {
    mintPk = new PublicKey(mint);
  } catch {
    return {};
  }

  // 1. Try Helius DAS first
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "helius-das",
        method: "getAsset",
        params: {
          id: mint
        }
      })
    });
    
    if (response.ok) {
      const json = await response.json();
      if (!json.error && json.result) {
        const item = json.result;
        const isNFT = item.interface === "Custom" || item.interface === "ProgrammableNFT" || item.interface === "NFT" || item.interface === "V1_NFT";
        const content = item.content || {};
        const metadata = content.metadata || {};
        const links = content.links || {};
        let image = content.files?.[0]?.uri || links.image || "";
        
        if (!image && content.json_uri) {
          try {
            const res = await fetch(content.json_uri);
            if (res.ok) {
              const resJson = await res.json();
              image = resJson.image || "";
            }
          } catch {}
        }

        if (!image && mint === "EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v") {
          image = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v/logo.png";
        }
        
        const tokenInfo = item.token_info || {};
        const symbol = tokenInfo.symbol || metadata.symbol || "";
        const name = metadata.name || (isNFT ? `NFT (${mint.slice(0, 4)}…)` : symbol || `Token (${mint.slice(0, 4)}…)`);
        const decimals = tokenInfo.decimals ?? 0;
        
        return {
          name,
          symbol,
          image,
          decimals,
          isNFT
        };
      }
    }
  } catch (e) {
    console.warn("Helius DAS getAsset failed, trying Metaplex fallback:", e);
  }

  // 2. Metaplex Metadata On-Chain Fallback
  try {
    const conn = new Connection(rpcUrl, "confirmed");
    const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    
    const [metadataPk] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
      METAPLEX_PROGRAM_ID
    );
    
    const accountInfo = await conn.getAccountInfo(metadataPk);
    if (accountInfo && accountInfo.data) {
      const parsed = parseMetaplexMetadata(accountInfo.data);
      if (parsed && parsed.uri) {
        let name = parsed.name || `NFT (${mint.slice(0, 4)}…)`;
        let image = "";
        try {
          const res = await fetch(parsed.uri);
          if (res.ok) {
            const json = await res.json();
            image = json.image || "";
            if (json.name) name = json.name;
          }
        } catch (e) {
          console.warn("Failed to fetch JSON metadata from URI:", parsed.uri, e);
        }
        const symbol = parsed.symbol || "";
        return {
          name,
          symbol,
          image,
          decimals: 0,
          isNFT: true
        };
      }
    }
  } catch (e) {
    console.error("Failed to resolve Metaplex metadata on-chain:", e);
  }

  return {};
}

/* ═══════════════════════════════════════════════════════════════════════
   PROJECT VIEW — /[slug]
   Premium public-facing page: project hero, box cards, open-box flow.
═══════════════════════════════════════════════════════════════════════ */

export default function ProjectView({ slug }: { slug: string }) {
  const wallet = useWallet();
  const { connected } = wallet;
  const branding = useProjectBranding();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [project, setProject]   = useState<Record<string, unknown>>({});
  const [loading, setLoading]   = useState(true);
  const [progressMsg, setProgressMsg] = useState("Connecting to blockchain...");
  const [allBoxes, setAllBoxes] = useState<LiveBox[]>([]);
  const [selectedBox, setSelectedBox] = useState<LiveBox | null>(null);
  const [vaultAssets, setVaultAssets] = useState<AssetInfo[]>([]);
  const [tokenMetaMap, setTokenMetaMap] = useState<Record<string, { symbol: string; name: string; decimals: number; image: string; isNFT?: boolean }>>({});
  const [prizeItems, setPrizeItems] = useState<Record<string, any[]>>({});
  const [liveWins, setLiveWins] = useState<string[]>([]);

  useEffect(() => {
    const conn = new Connection(RPC, "confirmed");
    const eventCoder = new BorshEventCoder(IDL as any);

    const subscriptionId = conn.onLogs(
      PGID,
      (logsInfo, ctx) => {
        const logs = logsInfo.logs;
        for (const log of logs) {
          if (log.includes("Program data:")) {
            try {
              const dataIndex = log.indexOf("Program data:") + 13;
              const eventLog = log.slice(dataIndex).trim();
              const ev = eventCoder.decode(eventLog);
              if (ev && ev.name === "BoxOpenEvent") {
                const data: any = ev.data;
                const userPubkey = data.user?.toBase58?.() || String(data.user);
                const userShort = userPubkey.slice(0, 4) + "…" + userPubkey.slice(-4);
                
                const amountWon = data.amountWon?.toNumber?.() ?? data.amountWon ?? 0;
                const won = data.won ?? false;
                
                let winMessage = "";
                if (won) {
                  const mint = data.tokenMint?.toBase58?.() || String(data.tokenMint);
                  const details = resolveTokenDetails(mint, tokenMetaMap);
                  const isNFT = details.isNFT || details.symbol === "NFT" || details.decimals === 0;
                  
                  if (details.symbol === "SOL") {
                    winMessage = `${userShort} won ${formatSol(amountWon)} SOL!`;
                  } else if (isNFT) {
                    winMessage = `${userShort} won a rare NFT!`;
                  } else {
                    const parsedAmount = amountWon / Math.pow(10, details.decimals);
                    winMessage = `${userShort} won ${parsedAmount.toLocaleString()} ${details.symbol}!`;
                  }
                } else {
                  winMessage = `${userShort} opened a box (no prize)`;
                }

                if (winMessage) {
                  setLiveWins(prev => [winMessage, ...prev].slice(0, 10));
                }
              }
            } catch (err) {
              console.debug("Failed to parse live log event:", err);
            }
          }
        }
      },
      "confirmed"
    );

    return () => {
      conn.removeOnLogsListener(subscriptionId).catch(console.error);
    };
  }, [tokenMetaMap]);

  const fallbackWins = useMemo(() => [
    "0xWizard won a Mythic Diamond Ape",
    "GeckoGuru won a Legendary Geckura #0842",
    "NeonFiona won an Epic Toxic Reptile",
    "LunaStack won a Rare Neon Claw",
    "ByteBaron won a Mythic Sacred Hex",
    "MoonKid won a Legendary Plasma Spine",
  ], []);

  const winsToDisplay = useMemo(() => {
    return [...liveWins, ...fallbackWins];
  }, [liveWins, fallbackWins]);

  useEffect(() => {
    if (allBoxes.length === 0) return;
    const allMints = new Set<string>();
    // Collect mints from accepted payment tokens
    allBoxes.forEach(b => {
      if (b.acceptedMints) {
        b.acceptedMints.forEach(mint => {
          if (mint && mint !== "11111111111111111111111111111111" && mint !== "EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v") {
            allMints.add(mint);
          }
        });
      }
    });
    // Also collect mints from prize items (NFTs, SPL tokens)
    Object.values(prizeItems).forEach(prizes => {
      prizes.forEach((prize: any) => {
        const mint = prize.token_mint;
        if (mint && mint !== "11111111111111111111111111111111" && mint !== "EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v") {
          allMints.add(mint);
        }
      });
    });

    const customMints = Array.from(allMints).filter(mint => !tokenMetaMap[mint]);
    if (customMints.length === 0) return;

    Promise.all(
      customMints.map(async (mint) => {
        try {
          const meta = await fetchAssetMetadata(mint, RPC);
          return { mint, meta };
        } catch (err) {
          console.warn("Failed to fetch custom token metadata:", mint, err);
          return { mint, meta: null };
        }
      })
    ).then((results) => {
      const updates: Record<string, { symbol: string; name: string; decimals: number; image: string; isNFT?: boolean }> = {};
      results.forEach(({ mint, meta }) => {
        if (meta && meta.name) {
          updates[mint] = {
            symbol: meta.symbol || meta.name.slice(0, 5).toUpperCase(),
            name: meta.name || "Custom Token",
            decimals: meta.decimals ?? 9,
            image: meta.image || "🎁",
            isNFT: meta.isNFT
          };
        }
      });
      if (Object.keys(updates).length > 0) {
        setTokenMetaMap(prev => ({ ...prev, ...updates }));
      }
    });
  }, [allBoxes, prizeItems]);

  const fetchProjectAndBoxes = useCallback(async () => {
    setLoading(true);
    setProgressMsg("Retrieving authority settings...");
    try {
      // 1. Fetch branding from Supabase via API route
      let supabaseBranding: any = null;
      try {
        const res = await fetch(`/api/branding?slug=${slug}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.project) {
            supabaseBranding = data.project;
          }
        }
      } catch (err) {
        console.error("Failed to fetch Supabase branding:", err);
      }

      const conn = new Connection(RPC, "confirmed");
      const [projectPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("project"), Buffer.from(slug)], PGID,
      );

      const acc = await retryWithBackoff(() => conn.getAccountInfo(projectPDA), "getAccountInfo(publicPage)");
      setProgressMsg("Scanning storefront packages...");
      const pgAccs = await retryWithBackoff(() => conn.getProgramAccounts(PGID), "getProgramAccounts(publicPage)");

      if (acc) {
        try {
          setProgressMsg("Decoding pack configurations...");
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          const decodedProject = new (BorshAccountsCoder as any)(IDL, PGID).decode("Project", acc.data);
          
          if (decodedProject) {
            decodedProject.name = decodedProject.name || "";
            decodedProject.description = decodedProject.description || "";
            decodedProject.logoUri = decodedProject.logoUri || "";
            decodedProject.bgUri = decodedProject.bgUri || "";
            decodedProject.themeColor = decodedProject.themeColor || "";

            if (supabaseBranding) {
              decodedProject.name = decodedProject.name || supabaseBranding.name || "";
              decodedProject.description = decodedProject.description || supabaseBranding.description || "";
              decodedProject.logoUri = decodedProject.logoUri || supabaseBranding.logo_uri || "";
              decodedProject.bgUri = decodedProject.bgUri || supabaseBranding.bg_uri || "";
              decodedProject.themeColor = decodedProject.themeColor || supabaseBranding.theme_color || "";
              decodedProject.navbarColor = supabaseBranding.navbar_color || "";
              decodedProject.textColor = supabaseBranding.text_color || "";
              decodedProject.nothingRewardImage = supabaseBranding.nothing_reward_image || "";
              decodedProject.twitterUsername = supabaseBranding.twitter_username || "";
              decodedProject.magicEdenLink = supabaseBranding.magic_eden_link || "";
              decodedProject.discordLink = supabaseBranding.discord_link || "";
              decodedProject.twitterLink = supabaseBranding.twitter_link || "";
            } else if (typeof window !== "undefined") {
              const localBranding = localStorage.getItem(`project_branding_${slug}`);
              if (localBranding) {
                try {
                  const parsed = JSON.parse(localBranding);
                  decodedProject.name = decodedProject.name || parsed.name || "";
                  decodedProject.description = decodedProject.description || parsed.description || "";
                  decodedProject.logoUri = decodedProject.logoUri || parsed.logoUri || "";
                  decodedProject.bgUri = decodedProject.bgUri || parsed.bgUri || "";
                  decodedProject.themeColor = decodedProject.themeColor || parsed.themeColor || "";
                  decodedProject.navbarColor = parsed.navbarColor || "";
                  decodedProject.textColor = parsed.textColor || "";
                  decodedProject.nothingRewardImage = parsed.nothingRewardImage || "";
                  decodedProject.twitterUsername = parsed.twitterUsername || "";
                  decodedProject.magicEdenLink = parsed.magicEdenLink || "";
                  decodedProject.discordLink = parsed.discordLink || "";
                  decodedProject.twitterLink = parsed.twitterLink || "";
                } catch {}
              }
            }
          }
          
          console.log("[ProjectView] Decoded Project account:", decodedProject);
          setProject(decodedProject);
        } catch (e) { 
          console.warn("[ProjectView] Failed to decode Project account:", e);
          const fallback: any = { name: slug };
          if (supabaseBranding) {
            fallback.name = supabaseBranding.name || fallback.name;
            fallback.description = supabaseBranding.description || "";
            fallback.logoUri = supabaseBranding.logo_uri || "";
            fallback.bgUri = supabaseBranding.bg_uri || "";
            fallback.themeColor = supabaseBranding.theme_color || "";
            fallback.navbarColor = supabaseBranding.navbar_color || "";
            fallback.textColor = supabaseBranding.text_color || "";
            fallback.nothingRewardImage = supabaseBranding.nothing_reward_image || "";
            fallback.twitterUsername = supabaseBranding.twitter_username || "";
            fallback.magicEdenLink = supabaseBranding.magic_eden_link || "";
            fallback.discordLink = supabaseBranding.discord_link || "";
            fallback.twitterLink = supabaseBranding.twitter_link || "";
          } else if (typeof window !== "undefined") {
            const localBranding = localStorage.getItem(`project_branding_${slug}`);
            if (localBranding) {
              try {
                const parsed = JSON.parse(localBranding);
                Object.assign(fallback, parsed);
              } catch {}
            }
          }
          setProject(fallback); 
        }
      } else {
        const fallback: any = { name: slug };
        if (supabaseBranding) {
          fallback.name = supabaseBranding.name || fallback.name;
          fallback.description = supabaseBranding.description || "";
          fallback.logoUri = supabaseBranding.logo_uri || "";
          fallback.bgUri = supabaseBranding.bg_uri || "";
          fallback.themeColor = supabaseBranding.theme_color || "";
          fallback.navbarColor = supabaseBranding.navbar_color || "";
          fallback.textColor = supabaseBranding.text_color || "";
          fallback.nothingRewardImage = supabaseBranding.nothing_reward_image || "";
          fallback.twitterUsername = supabaseBranding.twitter_username || "";
          fallback.magicEdenLink = supabaseBranding.magic_eden_link || "";
          fallback.discordLink = supabaseBranding.discord_link || "";
          fallback.twitterLink = supabaseBranding.twitter_link || "";
        } else if (typeof window !== "undefined") {
          const localBranding = localStorage.getItem(`project_branding_${slug}`);
          if (localBranding) {
            try {
              const parsed = JSON.parse(localBranding);
              Object.assign(fallback, parsed);
            } catch {}
          }
        }
        setProject(fallback);
      }

      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const coder = new (BorshAccountsCoder as any)(IDL, PGID);
      const result: LiveBox[] = [];
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      for (const { pubkey, account } of (pgAccs as any[])) {
        try {
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          const b: any = coder.decode("BoxConfig", account.data);
          if (b.project?.equals?.(projectPDA)) {
            const boxId = b.boxId?.toNumber?.()  ?? b.boxId ?? b.box_id?.toNumber?.() ?? b.box_id ?? 0;
            let boxName = `Box #${boxId}`;
            let boxDesc = "Mystery box from the Geckura ecosystem.";
            let boxBanner = null;

            const sbBox = supabaseBranding?.boxes?.find((bx: any) => bx.box_id === boxId);
            if (sbBox) {
              boxName = sbBox.name || boxName;
              boxDesc = sbBox.description || boxDesc;
              boxBanner = sbBox.banner_uri || boxBanner;
            } else if (typeof window !== "undefined") {
              const localBox = localStorage.getItem(`box_branding_${slug}_${boxId}`);
              if (localBox) {
                try {
                  const parsed = JSON.parse(localBox);
                  boxName = parsed.name || boxName;
                  boxDesc = parsed.description || boxDesc;
                  boxBanner = parsed.bannerUri || boxBanner;
                } catch {}
              }
            }
            result.push({
              pubkey:     pubkey.toBase58(),
              boxId,
              project:    b.project?.toBase58?.() ?? "",
              name:       boxName,
              description: boxDesc,
              priceLamports: b.priceLamports?.toNumber?.() ?? b.priceLamports ?? b.price_lamports?.toNumber?.() ?? b.price_lamports ?? 0,
              bannerUri:  boxBanner,
              acceptedMints: b.acceptedMints?.map?.((m: { toBase58?: () => string }) => m?.toBase58?.()) ?? b.accepted_mints?.map?.((m: { toBase58?: () => string }) => m?.toBase58?.()) ?? [],
              acceptedPrices: b.acceptedPrices?.map?.((p: { toNumber?: () => number }) => p?.toNumber?.() ?? p) ?? b.accepted_prices?.map?.((p: { toNumber?: () => number }) => p?.toNumber?.() ?? p) ?? [],
              supply:    b.supply?.toNumber?.() ?? b.supply ?? 0,
              sold:      b.sold?.toNumber?.()   ?? b.sold ?? 0,
              startTime: toUnixSeconds(b.startTime ?? b.start_time),
              endTime:   toUnixSeconds(b.endTime ?? b.end_time),
              status:    boxStatusToCode(b.status),
            } as LiveBox);
          }
        } catch { /* skip non-BoxConfig accounts */ }
      }
      const sortedBoxes = result.sort((a, b) => a.boxId - b.boxId);
      setAllBoxes(sortedBoxes);

      // Populate Prize Items map directly from BoxConfig
      const prizeItemMap: Record<string, any[]> = {};
      setProgressMsg("Reading prize pool configurations...");
      
      for (const box of sortedBoxes) {
        try {
          const boxConfigAccount = (pgAccs as any[]).find(a => a.pubkey.toBase58() === box.pubkey);
          if (boxConfigAccount) {
            const b: any = coder.decode("BoxConfig", boxConfigAccount.account.data);
            const boxPrizeItems = (b.prizes || []).map((p: any) => {
              let prize_type: "Sol" | "SplToken" | "Nft" = "SplToken";
              const rawType = p.prizeType ?? p.prize_type;
              if (typeof rawType === "number") {
                if (rawType === 0) prize_type = "Sol";
                else if (rawType === 1) prize_type = "SplToken";
                else if (rawType === 2) prize_type = "Nft";
              } else if (typeof rawType === "object" && rawType !== null) {
                const keys = Object.keys(rawType).map(k => k.toLowerCase());
                if (keys.includes("sol")) prize_type = "Sol";
                else if (keys.includes("spltoken") || keys.includes("token")) prize_type = "SplToken";
                else if (keys.includes("nft")) prize_type = "Nft";
              }
              const amtRaw = p.amount;
              const amountNum = typeof amtRaw === 'string'
                ? BigInt(amtRaw.startsWith('0x') ? amtRaw : `0x${amtRaw}`)
                : typeof amtRaw === 'bigint'
                  ? amtRaw
                  : BigInt(Number(amtRaw) || 0);
              
              const tmRaw = p.tokenMint ?? p.token_mint;
              const tokenMintStr = tmRaw?.toBase58?.() || String(tmRaw);

              return {
                index: p.index,
                prize_type,
                token_mint: tokenMintStr,
                amount: amountNum,
                win_percentage: p.winPercentage ?? p.win_percentage ?? 0,
                total_count: p.totalCount ?? p.total_count ?? 0,
                claimed_count: p.claimedCount ?? p.claimed_count ?? 0,
              };
            });
            boxPrizeItems.sort((a: any, b: any) => a.index - b.index);
            prizeItemMap[box.pubkey] = boxPrizeItems;
          }
        } catch (e) {
          console.error(`Failed to decode prize items for box ${box.boxId}:`, e);
        }
      }
      setPrizeItems(prizeItemMap);

      // Fetch Vault assets to show real names and images
      setProgressMsg("Verifying vault asset inventory...");
      const [vaultPk] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), projectPDA.toBuffer()], PGID
      );
      try {
        const vAssets = await fetchAssetsForOwner(vaultPk, RPC);
        setVaultAssets(vAssets);
      } catch (e) {
        console.error("Failed to load vault assets:", e);
      }
    } catch (e: unknown) { console.error("[ProjectView]", e); }
    setLoading(false);
  }, [slug]);

  const setBranding = useSetProjectBranding();
  
  /* ── Update navbar branding with project data ───────────── */
  useEffect(() => {
    console.log("[ProjectView] Current project state:", project);
    if (project) {
      const logoUri = resolveIpfsUrl((project.logo_uri || project.logoUri) as string | null | undefined) || null;
      const name = (project.name as string) || slug;
      const tColor = (project.themeColor || project.theme_color) as string | null | undefined;
      console.log("[ProjectView] Setting branding to:", { name, logoUrl: logoUri, themeColor: tColor });
      setBranding({
        name,
        logoUrl: logoUri,
        themeColor: tColor || null,
        navbarColor: (project.navbarColor as string) || null,
        textColor: (project.textColor as string) || null,
        nothingRewardImage: resolveIpfsUrl((project.nothingRewardImage as string | null | undefined)) || null,
        twitterUsername: (project.twitterUsername as string) || null,
        magicEdenLink: (project.magicEdenLink as string) || null,
        discordLink: (project.discordLink as string) || null,
        twitterLink: (project.twitterLink as string) || null,
      });

      // Set page title
      document.title = `${name} | Mystery Box`;

      // Set favicon dynamically
      if (logoUri) {
        updateFavicon(logoUri, (project.navbarColor as string) || null);
      }
    }
  }, [project, slug, setBranding]);

  /* ── Fetch project + boxes ─────────────────────────────── */
  useEffect(() => {
    fetchProjectAndBoxes();
  }, [fetchProjectAndBoxes]);

  const [activeTab, setActiveTab] = useState<"active" | "expired" | "claims">("active");
  const [selectedBoxForRewards, setSelectedBoxForRewards] = useState<LiveBox | null>(null);
  const [claimablePrizesData, setClaimablePrizesData] = useState<{
    box: LiveBox;
    receiptPda: PublicKey;
    prizes: {
      prizeIndex: number;
      prizeType: number;
      tokenMint: string;
      amount: string;
    }[];
  }[]>([]);
  const [claimingStates, setClaimingStates] = useState<Record<string, boolean>>({});

  const fetchClaimablePrizes = useCallback(async () => {
    if (!wallet.publicKey) {
      setClaimablePrizesData([]);
      return;
    }
    try {
      const conn = new Connection(RPC, "confirmed");
      const [projectPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("project"), Buffer.from(slug)],
        PGID
      );
      const [receiptPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), wallet.publicKey!.toBuffer(), projectPda.toBuffer()],
        PGID
      );
      
      const info = await conn.getAccountInfo(receiptPda);
      if (!info) {
        setClaimablePrizesData([]);
        return;
      }

      const claimablesList: typeof claimablePrizesData = [];
      try {
        const decoded = decodeAccount("BoxReceipt", info.data);
        const rawPrizes = decoded.claimablePrizes || decoded.claimable_prizes || [];
        
        // Group prizes by box_config
        const prizesByBox: Record<string, any[]> = {};
        for (const p of rawPrizes) {
          const boxConfigStr = (p.boxConfig ?? p.box_config).toBase58();
          if (!prizesByBox[boxConfigStr]) {
            prizesByBox[boxConfigStr] = [];
          }
          let pType = 0; // Sol
          if (p.prizeType && typeof p.prizeType === 'object') {
            const keys = Object.keys(p.prizeType).map(k => k.toLowerCase());
            if (keys.includes("spltoken") || keys.includes("token")) pType = 1;
            else if (keys.includes("nft")) pType = 2;
          } else if (typeof p.prizeType === 'number') {
            pType = p.prizeType;
          }
          const mintStr = (p.tokenMint ?? p.token_mint)?.toBase58?.() || String(p.token_mint ?? p.tokenMint);
          const amtStr = (p.amount ?? 0).toString();
          
          if (Number(amtStr) > 0) {
            prizesByBox[boxConfigStr].push({
              prizeIndex: Number(p.prizeIndex ?? p.prize_index ?? 0),
              prizeType: pType,
              tokenMint: mintStr,
              amount: amtStr,
            });
          }
        }

        // Map to claimablesList
        for (const [boxConfigStr, prizes] of Object.entries(prizesByBox)) {
          const box = allBoxes.find(b => b.pubkey === boxConfigStr);
          if (box && prizes.length > 0) {
            claimablesList.push({
              box,
              receiptPda,
              prizes,
            });
          }
        }
      } catch (decErr) {
        console.warn("[Claims] Failed to decode receipt:", decErr);
      }
      
      setClaimablePrizesData(claimablesList);
    } catch (err) {
      console.error("[Claims] Failed to fetch claimable prizes:", err);
    }
  }, [wallet.publicKey, allBoxes, slug]);

  useEffect(() => {
    fetchClaimablePrizes();
  }, [wallet.publicKey, activeTab, fetchClaimablePrizes]);

  const handleClaim = async (claimable: typeof claimablePrizesData[0]) => {
    const boxIdKey = claimable.box.pubkey;
    setClaimingStates(prev => ({ ...prev, [boxIdKey]: true }));
    const conn = new Connection(RPC, "confirmed");
    try {
      const tx = new Transaction();

      const [platformPda] = await platformPDA();
      const [projectPda] = await projectPDA(slug);
      const [vaultPda] = await vaultPDA(projectPda);

      const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
      const mintsToCreateATA: string[] = [];
      const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const ATA_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

      for (const prize of claimable.prizes) {
        if (prize.prizeType === 1 || prize.prizeType === 2) {
          const mint = new PublicKey(prize.tokenMint);
          const vaultAta = PublicKey.findProgramAddressSync(
            [vaultPda.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
            ATA_PROG
          )[0];
          const userAta = PublicKey.findProgramAddressSync(
            [wallet.publicKey!.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
            ATA_PROG
          )[0];

          if (!remainingAccounts.some(acc => acc.pubkey.equals(vaultAta))) {
            remainingAccounts.push({ pubkey: vaultAta, isSigner: false, isWritable: true });
          }
          if (!remainingAccounts.some(acc => acc.pubkey.equals(userAta))) {
            remainingAccounts.push({ pubkey: userAta, isSigner: false, isWritable: true });
          }

          if (!mintsToCreateATA.includes(prize.tokenMint)) {
            mintsToCreateATA.push(prize.tokenMint);
          }
        }
      }

      // Pre-create missing user ATAs
      for (const mintStr of mintsToCreateATA) {
        const mint = new PublicKey(mintStr);
        const userAta = PublicKey.findProgramAddressSync(
          [wallet.publicKey!.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
          ATA_PROG
        )[0];

        const userAtaInfo = await conn.getAccountInfo(userAta);
        if (!userAtaInfo) {
          tx.add(
            createAssociatedTokenAccountInstruction(
              wallet.publicKey!,
              userAta,
              wallet.publicKey!,
              mint
            )
          );
        }
      }

      const ix = ixClaimPrizes(
        platformPda,
        projectPda,
        claimable.receiptPda,
        vaultPda,
        wallet.publicKey!,
        slug,
        remainingAccounts
      );
      tx.add(ix);

      tx.feePayer = wallet.publicKey || undefined;
      const { blockhash } = await retryWithBackoff(
        () => conn.getLatestBlockhash("confirmed"),
        "getLatestBlockhash",
      ) as { blockhash: string };
      tx.recentBlockhash = blockhash;

      if (!wallet.signTransaction) throw new Error("Wallet does not support transaction signing");
      const signed = await wallet.signTransaction(tx);
      const sig = await retryWithBackoff(
        () => conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" }),
        "sendRawTransaction",
      );
      await retryWithBackoff(
        () => conn.confirmTransaction(sig, "confirmed"),
        "confirmTransaction",
      );

      toast.success("Rewards claimed successfully!");
      await fetchClaimablePrizes();
    } catch (err: any) {
      console.error("[Claim] Error claiming prizes:", err);
      if (err instanceof SendTransactionError) {
        try {
          const logs = await err.getLogs(conn);
          Object.defineProperty(err, "logs", { value: logs, configurable: true, writable: true });
          console.error("[Claim SendTransactionError Logs]", logs);
        } catch (logErr) {
          console.error("Failed to retrieve SendTransactionError logs in handleClaim:", logErr);
        }
      } else if (err && typeof (err as any).getLogs === "function") {
        try {
          console.error("[Claim Error Logs]", (err as any).getLogs());
        } catch {}
      }
      const msg = parseSolanaError(err);
      toast.error(`Claim failed: ${msg}`);
    } finally {
      setClaimingStates(prev => ({ ...prev, [boxIdKey]: false }));
    }
  };

  /* ── Render ─────────────────────────────────────────────── */
  const logoUri = resolveIpfsUrl((project.logoUri || project.logo_uri || project.logo_url) as string | undefined) || undefined;
  const themeColor = (project.themeColor || project.theme_color) as string | undefined;
  const bgUri   = resolveIpfsUrl((project.bgUri || project.bannerUri) as string | undefined) || undefined;
  const title   = (project.name as string) || slug;
  const desc    = (project.description as string) || "";
  const magicEdenLink = project.magicEdenLink as string | undefined;
  const discordLink = project.discordLink as string | undefined;
  const twitterLink = project.twitterLink as string | undefined;

  if (!mounted) return <Skeleton />;

  if (!connected) {
    // Custom styles based on project theme color
    const cardStyle = themeColor ? {
      backgroundColor: `${themeColor}12`, // tinted glass background (approx 7% opacity)
      borderColor: `${themeColor}25`, // border with approx 14% opacity
      boxShadow: `0 8px 32px 0 rgba(0, 0, 0, 0.4), 0 0 35px ${themeColor}15`,
    } : {};

    const glowBgStyle = themeColor ? {
      backgroundColor: `${themeColor}08`, // tinted radial gradient top-left glow
    } : {};

    const logoContainerStyle = themeColor ? {
      backgroundColor: `${themeColor}15`,
      borderColor: `${themeColor}30`,
      boxShadow: `0 0 20px ${themeColor}15`,
    } : {};

    const buttonClass = themeColor ? "!text-[#0f2618] hover:!opacity-95" : "!text-black hover:!bg-[#2ecc12]";
    const buttonStyle = themeColor ? {
      backgroundColor: themeColor,
      boxShadow: `0 0 25px ${themeColor}35`,
    } : {};

    return (
      <div 
        className={`min-h-screen flex flex-col items-center justify-center p-6 text-center ${bgUri ? "" : "gradient-bg"}`}
        style={bgUri ? {
          backgroundImage: `radial-gradient(circle at top, rgba(10, 10, 10, 0.4) 0%, rgba(10, 10, 10, 0.85) 100%), url('${bgUri}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
        } : {}}
      >
        <div 
          style={cardStyle}
          className="max-w-md w-full bg-[#ffffff]/70 border border-[#1cac64]/10 rounded-3xl p-8 backdrop-blur-xl space-y-6 shadow-2xl relative overflow-hidden ring-1 ring-white/10 transition-all duration-300"
        >
          <div 
            style={glowBgStyle}
            className="absolute inset-0 bg-gradient-to-br from-[#1cac64]/5 via-transparent to-transparent pointer-events-none" 
          />
          
          <div className="space-y-1.5 text-center">
            <h1 className="text-xl font-black text-[#0f2618] tracking-tight uppercase">{title} Mystery Box</h1>
            <p className="text-xs text-[#3d6b4e] font-medium">Connect wallet to get access</p>
          </div>
          
          <div className="flex justify-center pt-2">
            <WalletMultiButton 
              style={buttonStyle}
              className={`!bg-[#1cac64] hover:!scale-[1.02] ${buttonClass} !transition-all !rounded-xl !h-12 !px-6 !text-sm !font-bold shadow-[0_0_20px_rgba(28,172,100,0.25)]`} 
            />
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    const loaderStyle = themeColor ? {
      borderTopColor: themeColor,
    } : {
      borderTopColor: '#1cac64',
    };

    const textStyle = themeColor ? {
      color: themeColor,
    } : {
      color: '#1cac64',
    };

    return (
      <div 
        className={`min-h-screen flex flex-col items-center justify-center p-6 text-center ${bgUri ? "" : "gradient-bg"}`}
        style={bgUri ? {
          backgroundImage: `radial-gradient(circle at top, rgba(10, 10, 10, 0.4) 0%, rgba(10, 10, 10, 0.85) 100%), url('${bgUri}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
        } : {}}
      >
        <div className="max-w-md w-full bg-[#ffffff]/70 border border-[#1cac64]/10 rounded-3xl p-8 backdrop-blur-xl space-y-6 shadow-2xl relative overflow-hidden ring-1 ring-white/10">
          <div className="flex flex-col items-center justify-center py-12 space-y-5">
            <div 
              style={loaderStyle}
              className="h-10 w-10 border-2 border-[#1cac64]/15 rounded-full animate-spin shadow-[0_0_15px_rgba(255,255,255,0.02)]" 
            />
            <div className="space-y-1">
              <p className="text-xs text-[#3d6b4e] uppercase tracking-widest font-mono">Loading Storefront</p>
              <p 
                style={textStyle}
                className="text-sm font-semibold text-[#1cac64] animate-pulse"
              >
                {progressMsg}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const activeBoxes = allBoxes.filter(b => {
    const isSoldOut = (b.sold || 0) >= (b.supply || 1);
    return !isSoldOut && boxStatusToCode(b.status) === 0 && now <= b.endTime;
  });
  const endedBoxes  = allBoxes.filter(b => {
    const isSoldOut = (b.sold || 0) >= (b.supply || 1);
    return isSoldOut || boxStatusToCode(b.status) !== 0 || now > b.endTime;
  });
  const currentBoxes = activeTab === "active" ? activeBoxes : endedBoxes;

  return (
    <div 
      className={`min-h-screen flex flex-col ${bgUri ? "" : "gradient-bg"}`}
      style={bgUri ? {
        backgroundImage: `radial-gradient(circle at top, rgba(10, 10, 10, 0.15) 0%, rgba(10, 10, 10, 0.5) 100%), url('${bgUri}')`,
        backgroundSize: 'cover, cover',
        backgroundPosition: 'center, center',
        backgroundRepeat: 'no-repeat, no-repeat',
        backgroundAttachment: 'fixed, fixed',
      } : {}}
    >
      {/* ─── LIVE WINNINGS TICKER ─── */}
      <div className="w-full bg-[#ebfde3]/60 border-b border-[#1cac64]/10 backdrop-blur-md relative z-40 overflow-hidden py-3">
        <Ticker items={winsToDisplay} />
      </div>

      <div className="flex-grow">
        <div className="relative overflow-hidden">

        {/* Subtle animated particles (CSS-based) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="absolute rounded-full bg-[#1cac64]/10 blur-xl float-anim"
              style={{
                width: `${20 + i * 15}px`, height: `${20 + i * 15}px`,
                left: `${10 + i * 16}%`, top: `${20 + (i % 3) * 25}%`,
                animationDelay: `${i * 0.8}s`, animationDuration: `${5 + i}s`,
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-12 pb-7 sm:pt-16 sm:pb-10">
          <div className="flex flex-col items-center justify-center text-center space-y-6">
            {/* Title */}
            <div className="space-y-2">
              <motion.h1
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="text-4xl sm:text-5xl font-black text-[#0f2618] tracking-tight uppercase"
                style={{ textShadow: "0 2px 10px rgba(0,0,0,0.5)" }}
              >
                {title}
              </motion.h1>
            </div>

            {/* Description */}
            {desc && (
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.5 }}
                className="text-base sm:text-lg text-[#1a3a2a] max-w-2xl leading-relaxed text-center"
                style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}
              >
                {desc}
              </motion.p>
            )}

            {/* Social Links Row */}
            {twitterLink && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 0.4 }}
                className="flex items-center gap-4 justify-center"
              >
                <a
                  href={twitterLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3 bg-black/50 border border-[#1cac64]/20 rounded-2xl text-[#ebfde3] hover:text-white hover:border-[#1cac64] hover:shadow-[0_0_15px_rgba(28,172,100,0.3)] transition-all transform hover:-translate-y-1 cursor-pointer flex items-center justify-center"
                  title="Twitter (X)"
                >
                  <TwitterXIcon className="w-5 h-5 text-sky-400 hover:text-white" />
                </a>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ MYSTERY PACKS GRID ════════════════════════════════ */}
      <div className="mx-auto max-w-6xl px-5 sm:px-8 pb-20">

        {/* Section header with tabs */}
        <div className="flex items-center justify-center mb-6">
          <h2 className="text-lg font-bold text-[#0f2618]">Mystery Packs</h2>
        </div>

        {/* Tabs */}
        <div className="relative flex gap-1.5 mb-8 bg-black/20 backdrop-blur-lg rounded-2xl p-1 border border-[#1cac64]/10 mx-auto max-w-xl shadow-inner z-10">
          {(["active", "expired", "claims"] as const).map((tab) => {
            const isActive = activeTab === tab;
            let label = "";
            if (tab === "active") {
              label = `Active Packs (${activeBoxes.length})`;
            } else if (tab === "expired") {
              label = `Expired Packs (${endedBoxes.length})`;
            } else {
              label = `My Claims ${claimablePrizesData.length > 0 ? `(${claimablePrizesData.length})` : ""}`;
            }

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="relative flex-1 py-3 text-xs sm:text-sm font-black transition-all duration-300 cursor-pointer rounded-xl select-none focus:outline-none flex items-center justify-center gap-1.5 uppercase tracking-wide"
                style={{
                  color: isActive ? "#ffffff" : "#4a7d5e",
                  backgroundColor: isActive ? (themeColor || "#1cac64") : "transparent",
                  boxShadow: isActive ? "0 4px 14px rgba(28, 172, 100, 0.3)" : "none"
                }}
              >
                <span className="flex items-center justify-center gap-1.5">
                  {tab === "active" && "📦"}
                  {tab === "expired" && "⌛"}
                  {tab === "claims" && "🏆"}
                  {label}
                  {tab === "claims" && claimablePrizesData.length > 0 && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {activeTab !== "claims" ? (
          currentBoxes.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-20 text-center rounded-3xl glass-panel relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#1cac64]/5 to-transparent pointer-events-none" />
              <span className="text-5xl block mb-4 animate-pulse">📦</span>
              <p className="text-[#2d5a3f] text-sm font-bold uppercase tracking-wider">
                {activeTab === "active" ? "No active packs available yet" : "No expired packs yet"}
              </p>
              <p className="text-[#4a7d5e] text-xs mt-2 leading-relaxed">Check back soon for the next loot drops!</p>
            </motion.div>
          ) : (
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 ${activeTab === "expired" ? "opacity-80" : ""}`}>
              {currentBoxes.map((b, i) => (
                <BoxCard 
                  key={b.pubkey} 
                  box={b} 
                  index={i} 
                  onSelect={() => setSelectedBox(b)} 
                  tokenMetaMap={tokenMetaMap}
                  onShowRewards={() => setSelectedBoxForRewards(b)}
                />
              ))}
            </div>
          )
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6 max-w-4xl mx-auto"
          >
            <div className="bg-[#111915]/90 border border-[#1cac64]/15 rounded-3xl p-6 shadow-xl relative overflow-hidden backdrop-blur-md">
              <div className="absolute top-0 right-0 w-64 h-64 bg-[#1cac64]/5 rounded-full blur-3xl pointer-events-none" />
              <h3 className="text-lg font-black text-white mb-2 flex items-center gap-2 uppercase tracking-wide">
                <span>🏆</span> My Claim Queue
              </h3>
              <p className="text-gray-400 text-sm leading-relaxed">
                Prizes won from opening boxes are securely queued here. Phantom preview won't show balance changes during opening. You can claim all won assets for any pack in a single batch transaction.
              </p>
            </div>

            {claimablePrizesData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 border border-dashed border-[#1cac64]/20 rounded-3xl bg-black/10 backdrop-blur-sm relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#1cac64]/5 to-transparent pointer-events-none" />
                <span className="text-6xl mb-4 animate-bounce">🎁</span>
                <h4 className="text-base font-black text-white uppercase tracking-wider">Your queue is empty</h4>
                <p className="text-gray-400 text-xs max-w-xs text-center mt-2 leading-relaxed">
                  Open packs to accumulate prizes here. There are no claimable rewards waiting at this moment.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {claimablePrizesData.map((claimable) => {
                  const isClaiming = claimingStates[claimable.box.pubkey] || false;
                  return (
                    <div
                      key={claimable.box.pubkey}
                      className="relative overflow-hidden bg-black/40 backdrop-blur-md border border-[#1cac64]/15 rounded-3xl p-6 transition-all duration-300 hover:border-[#1cac64]/30 hover:shadow-[0_8px_30px_rgba(28,172,100,0.15)] group"
                      style={themeColor ? { borderColor: `${themeColor}20` } : {}}
                    >
                      {/* Box Banner / Name */}
                      <div className="flex items-center gap-4 mb-5">
                        <div className="w-14 h-14 rounded-2xl bg-black/40 flex items-center justify-center overflow-hidden border border-white/10 shadow-inner">
                          {claimable.box.bannerUri && claimable.box.bannerUri.startsWith("http") ? (
                            <img src={claimable.box.bannerUri} alt={claimable.box.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-3xl">🎁</span>
                          )}
                        </div>
                        <div>
                          <h4 className="font-extrabold text-white text-base leading-tight group-hover:text-[#1cac64] transition-colors">
                            {claimable.box.name}
                          </h4>
                          <span className="text-xs text-gray-400 font-mono mt-1 block">
                            {claimable.prizes.length} pending reward{claimable.prizes.length > 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>

                      {/* Prizes List */}
                      <div className="space-y-2.5 mb-6 bg-black/30 border border-white/5 rounded-2xl p-4">
                        {claimable.prizes.map((prize, idx) => {
                          const meta = resolveTokenDetails(prize.tokenMint, tokenMetaMap);
                          const decimals = meta.decimals ?? 9;
                          const displayAmount = Number(prize.amount) / Math.pow(10, decimals);
                          
                          return (
                            <div key={idx} className="flex items-center justify-between text-sm py-1.5 border-b border-white/[0.03] last:border-b-0">
                              <div className="flex items-center gap-2.5">
                                {meta.image && meta.image.startsWith("http") ? (
                                  <img src={meta.image} alt={meta.symbol} className="w-6 h-6 rounded-full border border-white/10" />
                                ) : (
                                  <span className="text-lg">🎁</span>
                                )}
                                <span className="text-gray-300 font-medium text-xs sm:text-sm">{meta.name}</span>
                              </div>
                              <span className="font-mono font-bold text-white text-xs sm:text-sm bg-white/5 px-2.5 py-0.5 rounded-lg border border-white/5">
                                {displayAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} {meta.symbol}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Claim Button */}
                      <button
                        onClick={() => handleClaim(claimable)}
                        disabled={isClaiming}
                        style={!isClaiming ? {
                          background: themeColor ? `linear-gradient(135deg, ${themeColor}, ${themeColor}dd)` : undefined,
                          boxShadow: themeColor ? `0 4px 15px ${themeColor}30` : undefined,
                        } : {}}
                        className={`w-full py-3.5 rounded-2xl font-bold text-white transition-all duration-300 hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2 shadow-lg cursor-pointer bg-gradient-to-r from-[#1cac64] to-emerald-500 ${
                          isClaiming ? "bg-gray-700" : ""
                        }`}
                      >
                        {isClaiming ? (
                          <>
                            <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Claiming...
                          </>
                        ) : (
                          <>
                            <span>📥</span> Claim Rewards
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* ═══ OPEN BOX MODAL ════════════════════════════════════ */}
      <AnimatePresence>
        {selectedBox && (
          <OpenBoxModal
            box={selectedBox}
            slug={slug}
            project={project}
            onClose={async () => {
              setSelectedBox(null);
              await fetchProjectAndBoxes();
              await fetchClaimablePrizes();
            }}
            vaultAssets={vaultAssets}
            tokenMetaMap={tokenMetaMap}
            claimablePrizesCount={claimablePrizesData.reduce((acc: number, c: any) => acc + (c.prizes?.length || 0), 0)}
          />
        )}
      </AnimatePresence>

      {/* ═══ REWARDS MODAL ════════════════════════════════════ */}
      <AnimatePresence>
        {selectedBoxForRewards && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setSelectedBoxForRewards(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-lg mx-4 bg-[#111] rounded-2xl border border-[#1cac64]/12 shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="p-6 border-b border-[#1cac64]/10 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {selectedBoxForRewards.name || `Pack #${selectedBoxForRewards.boxId}`}
                  </h2>
                  <p className="text-xs text-gray-400 mt-1">Possible Rewards</p>
                </div>
                <button
                  onClick={() => setSelectedBoxForRewards(null)}
                  className="p-2 rounded-xl hover:bg-[#1cac64]/6 transition-colors text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              {/* Rewards List */}
              <div className="p-6 max-h-96 overflow-y-auto">
                {prizeItems[selectedBoxForRewards.pubkey]?.length > 0 ? (
                  <div className="space-y-4">
                    {prizeItems[selectedBoxForRewards.pubkey].map((prize, idx) => {
                      const tokenDetails = resolveTokenDetails(
                        prize.token_mint,
                        tokenMetaMap
                      );
                      const amount = prize.amount;
                      const isNothing = Number(amount) === 0;
                      const displayName = isNothing ? "Nothing" : tokenDetails.name;
                      const displayImage = isNothing
                        ? (branding.nothingRewardImage && branding.nothingRewardImage !== "🎁" ? branding.nothingRewardImage : "/nothing.png")
                        : tokenDetails.image;
                      const remaining = (prize.total_count ?? 0) - (prize.claimed_count ?? 0);
                      
                      return (
                        <div key={idx} className="flex items-center gap-4 p-4 rounded-xl bg-[#1cac64]/4 border border-white/[0.05]">
                          {displayImage && (displayImage.startsWith("http") || displayImage.startsWith("/")) ? (
                            <img
                              src={displayImage}
                              alt={displayName}
                              className="h-14 w-14 rounded-xl object-cover border border-[#1cac64]/12"
                            />
                          ) : (
                            <div className="h-14 w-14 rounded-xl border border-[#1cac64]/12 bg-[#ebfde3]/60 flex items-center justify-center text-2xl select-none">
                              {displayImage || "🎁"}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-bold text-white truncate">{displayName}</p>
                            <p className="text-sm text-gray-300 mt-1 font-mono">
                              {isNothing 
                                ? "Better luck next time!"
                                : prize.prize_type === "Sol" 
                                  ? `${(Number(amount) / 1e9).toFixed(4)} SOL`
                                  : (prize.prize_type === "Nft" || tokenDetails.isNFT)
                                    ? "1x NFT"
                                    : `${(Number(amount) / Math.pow(10, tokenDetails.decimals)).toFixed(2)} ${tokenDetails.symbol}`
                              }
                            </p>
                            <div className="flex items-center gap-3 mt-3">
                              <span className="text-[11px] px-3 py-1 rounded-full bg-[#1cac64]/10 text-[#1cac64] border border-[#1cac64]/20 font-semibold">
                                {prize.win_percentage}% Chance
                              </span>
                              <span className="text-[11px] text-gray-400 font-medium">
                                {remaining} / {prize.total_count ?? 0} available
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <span className="text-5xl block mb-4">🎁</span>
                    <p className="text-gray-300 text-sm">No rewards listed yet</p>
                    <p className="text-gray-400 text-xs mt-2">Check back soon!</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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

/* ═══════════════════════════════════════════════════════════════════════
   BOX CARD — Premium card with hover effects & live data
═══════════════════════════════════════════════════════════════════════ */

function BoxCard({ box, index, onSelect, tokenMetaMap, onShowRewards }: { box: LiveBox; index: number; onSelect: () => void; tokenMetaMap: Record<string, { symbol: string; name: string; decimals: number; image: string; isNFT?: boolean }>; onShowRewards: () => void }) {
  const { connected }  = useWallet();
  const branding       = useProjectBranding();
  const themeColor     = branding.themeColor || undefined;
  const now           = Math.floor(Date.now() / 1000);
  const sold          = box.sold || 0;
  const sup           = box.supply || 1;
  const pct           = Math.min(100, Math.round((sold / sup) * 100));
  const statusCode    = boxStatusToCode(box.status);
  const active        = statusCode === 0;
  const hasTime       = box.endTime && box.endTime > now;
  const hasStarted = !box.startTime || box.startTime <= now;
  const remaining     = sup - sold;
  const isExpired     = !hasTime || statusCode !== 0;
  
  let statusLabel: string;
  if (!hasStarted) {
    statusLabel = "Upcoming";
  } else if (isExpired) {
    statusLabel = remaining === 0 ? "Sold Out" : "Expired";
  } else {
    statusLabel = ["Active", "Paused", "Ended"][statusCode] ?? "Unknown";
  }
  
  let statusClass: string;
  if (!hasStarted) {
    statusClass = "bg-purple-500/12 text-purple-400 border-purple-500/20";
  } else if (isExpired) {
    statusClass = remaining === 0 
      ? "bg-red-500/12 text-red-400 border-red-500/20"
      : "bg-gray-500/12 text-[#2d5a3f] border-gray-500/20";
  } else {
    statusClass = active
      ? "bg-[#1cac64]/12 text-[#1cac64] border-[#1cac64]/20"
      : statusCode === 1
      ? "bg-amber-400/12 text-amber-400 border-amber-400/20"
      : "bg-red-500/12 text-red-400 border-red-500/20";
  }

  const payOptions = useMemo(() => {
    const list: Array<{ index: number; mint: string; price: number; symbol: string; name: string; decimals: number; image: string }> = [];
    if (box.acceptedMints) {
      box.acceptedMints.forEach((mint: string, i: number) => {
        if (!mint || mint === "11111111111111111111111111111111") {
          if (i === 0 || (box.acceptedPrices && box.acceptedPrices[i] > 0)) {
            list.push({
              index: i,
              mint: "11111111111111111111111111111111",
              price: box.acceptedPrices?.[i] ?? box.priceLamports,
              ...resolveTokenDetails("11111111111111111111111111111111", tokenMetaMap)
            });
          }
        } else {
          const price = box.acceptedPrices?.[i] ?? 0;
          if (price > 0) {
            list.push({
              index: i,
              mint,
              price,
              ...resolveTokenDetails(mint, tokenMetaMap)
            });
          }
        }
      });
    }
    if (list.length === 0) {
      list.push({
        index: 0,
        mint: "11111111111111111111111111111111",
        price: box.priceLamports,
        ...resolveTokenDetails("11111111111111111111111111111111", tokenMetaMap)
      });
    }
    return list;
  }, [box, tokenMetaMap]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className={`group relative flex flex-col overflow-hidden rounded-2xl bg-black/45 border border-[#1cac64]/10
        hover:border-[#1cac64]/30 transition-all duration-500 card-hover shadow-lg ${
          remaining === 0 ? "opacity-75" : ""
        }`}
      style={themeColor ? {
        borderColor: `${themeColor}20`,
        boxShadow: `0 8px 32px 0 rgba(0, 0, 0, 0.25), 0 0 15px ${themeColor}10`
      } : {}}
    >
      {/* Banner */}
      <div className="relative w-full overflow-hidden bg-gradient-to-br from-[#f4fef0] to-[#ebfde3]">
        {box.bannerUri ? (
          <img
            src={resolveIpfsUrl(box.bannerUri)}
            alt={box.name}
            className={`w-full aspect-[4/3] object-cover group-hover:scale-105 transition-transform duration-700 ease-out ${
              remaining === 0 ? "grayscale opacity-40 contrast-75" : ""
            }`}
          />
        ) : (
          <div className="w-full aspect-[4/3] flex items-center justify-center">
            <span className="text-5xl opacity-20 group-hover:opacity-30 transition-opacity duration-500">🎁</span>
          </div>
        )}

        {/* Lock overlay for sold out */}
        {remaining === 0 && (
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] flex items-center justify-center pointer-events-none z-10">
            <span className="text-2xl font-black text-white/90 bg-black/60 border border-white/10 px-4 py-2 rounded-xl uppercase tracking-wider flex items-center gap-1.5 shadow-md">
              Sold Out
            </span>
          </div>
        )}

        {/* Status badge */}
        <div className="absolute top-3 left-3 z-20">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border backdrop-blur-md ${statusClass}`}>
            {statusLabel}
          </span>
        </div>

        {/* Countdown timer */}
        {active && hasTime && hasStarted && remaining > 0 && (
          <div className="absolute bottom-3 left-3 z-20">
            <motion.span 
              className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border bg-black/60 text-[#1cac64] border-[#1cac64]/20 backdrop-blur-md flex items-center gap-1.5 cursor-default"
              whileHover={{ scale: 1.05, backgroundColor: "rgba(0, 0, 0, 0.8)", borderColor: "rgba(28, 172, 100, 0.4)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#1cac64] animate-pulse" />
              {timeLeft(box.endTime)}
            </motion.span>
          </div>
        )}

        {/* Rewards Button */}
        <div className="absolute top-3 right-3 z-20">
          <motion.button
            onClick={(e) => { e.stopPropagation(); onShowRewards(); }}
            className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/[0.08] text-[#1a3a2a] border border-white/[0.12] hover:bg-[#1cac64]/15 hover:text-[#1cac64] hover:border-[#1cac64]/25 transition-all cursor-pointer"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Rewards
          </motion.button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-grow p-5 flex flex-col relative">
        {/* Subtle radial sheen glow inside the card */}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/[0.01] via-transparent to-transparent pointer-events-none" />

        <h3 className="text-base font-bold text-white leading-snug group-hover:text-[#1cac64] transition-colors duration-300 relative z-10">
          {box.name || `Pack #${box.boxId}`}
        </h3>
        {box.description && (
          <p className="text-xs text-[#a3d9b7] mt-1.5 line-clamp-2 leading-relaxed relative z-10">{box.description}</p>
        )}

        {/* Progress bar */}
        <div className="mt-5 relative z-10">
          <div className="flex justify-between text-[11px] mb-1.5">
            <span className="text-[#a3d9b7]/80">{sold} / {sup} opened</span>
            <span className={`font-mono font-semibold ${remaining <= 10 && active ? "text-amber-400" : remaining === 0 ? "text-red-400" : "text-[#1cac64]"}`}>
              {remaining > 0 ? `${remaining} left` : "Sold out"}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden border border-white/5">
            <motion.div
              className={`h-full rounded-full ${
                remaining === 0 
                  ? "bg-gradient-to-r from-gray-600 to-gray-500" 
                  : "bg-gradient-to-r from-[#1cac64] to-emerald-400"
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, delay: index * 0.1 }}
            />
          </div>
        </div>

        {/* CTA & Accepted Currencies */}
        <div className="mt-5 flex items-center justify-between gap-4 relative z-10">
          {/* Accepted payment tokens */}
          {payOptions.length > 0 && (
            <div className="flex-1">
              <p className="text-[9px] text-[#a3d9b7]/80 font-bold uppercase tracking-wider mb-1">Accepted Currencies</p>
              <div className="flex flex-wrap gap-1.5">
                {payOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 bg-[#1cac64]/10 border border-[#1cac64]/20 rounded-xl px-2 py-0.5 hover:border-[#1cac64]/40 hover:bg-[#1cac64]/20 transition duration-300">
                    {opt.image && opt.image !== "🎁" ? (
                      <img src={resolveIpfsUrl(opt.image)} alt={opt.symbol} className="h-3 w-3 object-contain rounded-full border border-[#1cac64]/12" />
                    ) : (
                      <span className="text-[9px]">🎁</span>
                    )}
                    <span className="text-[9px] font-mono font-bold text-white">
                      {(opt.price / Math.pow(10, opt.decimals)).toFixed(2)} <span className="text-[#a3d9b7] font-sans font-normal">{opt.symbol}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA Button */}
          <div>
            {!connected ? (
              <span className="text-[10px] text-[#a3d9b7] bg-[#1cac64]/10 border border-[#1cac64]/20 px-3 py-2 rounded-xl whitespace-nowrap">
                Connect wallet
              </span>
            ) : active && remaining > 0 && hasStarted ? (
              <motion.button
                onClick={(e) => { e.stopPropagation(); onSelect(); }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                style={{
                  background: themeColor ? `linear-gradient(135deg, ${themeColor}, ${themeColor}dd)` : undefined,
                  boxShadow: themeColor ? `0 0 20px ${themeColor}40` : undefined,
                }}
                className="text-xs font-bold text-black bg-gradient-to-r from-[#1cac64] to-emerald-400 px-4 py-2 rounded-xl whitespace-nowrap
                  shadow-[0_0_20px_rgba(28,172,100,0.25)] group-hover:shadow-[0_0_35px_rgba(28,172,100,0.4)] transition-shadow duration-500 cursor-pointer"
              >
                Open Pack
              </motion.button>
            ) : !hasStarted && active && remaining > 0 ? (
              <span className="text-[10px] text-purple-400 bg-purple-500/10 border border-purple-500/20 px-3 py-2 rounded-xl whitespace-nowrap">
                Starts soon
              </span>
            ) : remaining === 0 ? (
              <span className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-xl whitespace-nowrap font-bold flex items-center gap-1">
                🔒 Sold Out
              </span>
            ) : (
              <span className="text-[10px] text-gray-400 bg-white/5 border border-white/10 px-3 py-2 rounded-xl whitespace-nowrap">
                Ended
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom glow line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#1cac64]/20 to-transparent
        opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OPEN BOX MODAL — Quantity selector, price breakdown, tx flow
═══════════════════════════════════════════════════════════════════════ */

function OpenBoxModal({ box, slug, onClose, vaultAssets, tokenMetaMap, project, claimablePrizesCount = 0 }: { box: LiveBox; slug: string; onClose: () => void; vaultAssets: AssetInfo[]; tokenMetaMap: Record<string, { symbol: string; name: string; decimals: number; image: string; isNFT?: boolean }>; project: any; claimablePrizesCount?: number }) {
  const wallet = useWallet();
  const branding = useProjectBranding();
  const logoUrl = branding.logoUrl || resolveIpfsUrl((project?.logoUri || project?.logo_uri || project?.logo_url) as string | undefined) || undefined;
  const { addNotification } = useAppStore();
  const [qty, setQty]       = useState(1);
  const [phase, setPhase]   = useState<"select" | "signing" | "confirming" | "success" | "error">("select");
  const [txSig, setTxSig]   = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("Transaction submitted. Confirming on Solana…");
  const hasSetSuccess = useRef(false); // Track if we've set success state
  const wonRewardsRef = useRef<any[] | null>(null); // REF to store wonRewards permanently!
  const [wonRewardsState, setWonRewardsState] = useState<Array<{
    name: string;
    amount: number;
    image: string;
    isSol?: boolean;
    isNFT?: boolean;
    symbol?: string;
  }> | null>(null);

  // Helper to set both state AND ref!
  const setWonRewards = (value: any[] | null) => {
    wonRewardsRef.current = value;
    setWonRewardsState(value);
  };

  // When we need to read wonRewards, we use the REF as source of truth!
  const wonRewards = wonRewardsRef.current;

  useEffect(() => {
    if (phase === "select") {
      // Reset everything when back to select phase!
      wonRewardsRef.current = null;
      hasSetSuccess.current = false;
      setWonRewardsState(null);
    }
    console.log("[OpenBox] wonRewardsState changed:", wonRewardsState);
    console.log("[OpenBox] wonRewardsRef.current is:", wonRewardsRef.current);
  }, [phase, wonRewardsState]);

  const active    = boxStatusToCode(box.status) === 0;
  const remaining = (box.supply || 0) - (box.sold || 0);
  const maxQty    = Math.min(remaining, 5);

  const payOptions = useMemo(() => {
    const list: Array<{ index: number; mint: string; price: number; symbol: string; name: string; decimals: number; image: string }> = [];
    if (box.acceptedMints) {
      box.acceptedMints.forEach((mint: string, i: number) => {
        if (!mint || mint === "11111111111111111111111111111111") {
          if (i === 0 || (box.acceptedPrices && box.acceptedPrices[i] > 0)) {
            list.push({
              index: i,
              mint: "11111111111111111111111111111111",
              price: box.acceptedPrices?.[i] ?? box.priceLamports,
              ...resolveTokenDetails("11111111111111111111111111111111", tokenMetaMap)
            });
          }
        } else {
          const price = box.acceptedPrices?.[i] ?? 0;
          if (price > 0) {
            list.push({
              index: i,
              mint,
              price,
              ...resolveTokenDetails(mint, tokenMetaMap)
            });
          }
        }
      });
    }
    if (list.length === 0) {
      list.push({
        index: 0,
        mint: "11111111111111111111111111111111",
        price: box.priceLamports,
        ...resolveTokenDetails("11111111111111111111111111111111", tokenMetaMap)
      });
    }
    return list;
  }, [box, tokenMetaMap]);

  const [selectedPayIndex, setSelectedPayIndex] = useState<number>(0);
  const selectedOption = payOptions[selectedPayIndex];
  const platformFeeLamports = Number(project?.feeLamports ?? 0);
  const isPaySol = selectedOption.mint === "11111111111111111111111111111111";

  const totalCost = selectedOption.price * qty;
  const totalSolFee = platformFeeLamports * qty;

  const formattedPrice = (selectedOption.price / Math.pow(10, selectedOption.decimals)).toFixed(4);
  const formattedTotal = (totalCost / Math.pow(10, selectedOption.decimals)).toFixed(4);
  const formattedSolFee = (totalSolFee / 1e9).toFixed(4);

  const qtyOptions = [1, 3, 5].filter(n => n <= maxQty);

const handleOpen = useCallback(async () => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        toast.error("Connect your wallet first");
        return;
      }
      if (claimablePrizesCount >= 10) {
        const warnMsg = "Your receipt storage is full (10 pending prizes). Please claim your rewards in the 'My Claims' tab before opening more boxes!";
        toast.error(warnMsg);
        setErrMsg(warnMsg);
        setPhase("error");
        return;
      }
      setPhase("signing"); setErrMsg(""); setWonRewards(null);
      let sig = "";
      let revealSig = "";
      const bigIntReplacer = (key: any, value: any) => 
        typeof value === 'bigint' ? value.toString() : value;
      const conn = new Connection(RPC, "confirmed");
      try {
        const boxConfigPk = new PublicKey(box.pubkey);

        /* Fetch Project account to read fee_wallet and tenant (authority) addresses required by buy_box */
        const projectPk = new PublicKey(box.project);
        const projectAcc = await retryWithBackoff(
          () => conn.getAccountInfo(projectPk),
          "getAccountInfo(project_fee_wallet)"
        );
        let feeWalletPk: PublicKey  = PGID;
        let feeWallet2Pk: PublicKey = PGID;
        let tenantPk: PublicKey     = PGID;
        if (projectAcc) {
          const proj: any = new (BorshAccountsCoder as any)(IDL, PGID).decode("Project", projectAcc.data);
          const feeWalletVal = proj?.feeWallet ?? proj?.fee_wallet;
          feeWalletPk = feeWalletVal ? new PublicKey(feeWalletVal) : new PublicKey("11111111111111111111111111111111");
          const feeWallet2Val = proj?.feeWallet2 ?? proj?.fee_wallet_2;
          feeWallet2Pk = feeWallet2Val ? new PublicKey(feeWallet2Val) : new PublicKey("11111111111111111111111111111111");
          const tenantVal = proj?.authority;
          tenantPk = tenantVal ? new PublicKey(tenantVal) : PGID;
        }

        /* Derive correct PDAs for platform, project, vault, and receipt accounts */
        const [platformPubkey] = await platformPDA();
        const [projectPubkey] = await projectPDA(slug);
        const boxConfigPubkey = new PublicKey(box.pubkey); // Use existing box pubkey directly!
        
        // Fetch BoxConfig data to get real box_id!
        const boxConfigAcc = await retryWithBackoff(() => conn.getAccountInfo(boxConfigPubkey), "getAccountInfo(boxConfig)");
        let realBoxId: bigint = BigInt(box.boxId);
        if (boxConfigAcc) {
          const accountCoder = new BorshAccountsCoder(IDL as any);
          try {
            const decoded: any = accountCoder.decode("BoxConfig", boxConfigAcc.data);
            realBoxId = decoded.box_id ?? decoded.boxId;
            console.log("[OpenBox Debug] realBoxId from BoxConfig data:", realBoxId);
            console.log("[OpenBox Debug] realBoxId as number:", Number(realBoxId));
            console.log("[OpenBox Debug] realBoxId as string:", realBoxId.toString());
          } catch (decodeErr) {
            console.warn("[OpenBox Debug] Could not decode BoxConfig:", decodeErr);
          }
        }
        
        const [vaultPubkey] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), projectPubkey.toBuffer()],
          PGID,
        );
        const receiptPk = PublicKey.findProgramAddressSync(
          [Buffer.from("receipt"), wallet.publicKey.toBuffer(), projectPubkey.toBuffer()],
          PGID,
        )[0];
        
        console.log("[OpenBox Debug] platformPubkey:", platformPubkey.toBase58());
        console.log("[OpenBox Debug] projectPubkey:", projectPubkey.toBase58());
        console.log("[OpenBox Debug] box.pubkey (from box):", box.pubkey);
        console.log("[OpenBox Debug] boxConfigPubkey (from box):", boxConfigPubkey.toBase58());
        console.log("[OpenBox Debug] vaultPubkey:", vaultPubkey.toBase58());
        console.log("[OpenBox Debug] receiptPk:", receiptPk.toBase58());

        // Fetch all program accounts to load configured prizes for this box
        const pgAccs = await retryWithBackoff(() => conn.getProgramAccounts(PGID), "getProgramAccounts(openPrizes)");
        const accountCoder = new BorshAccountsCoder(IDL as any);
        
        const combinedPrizes: Array<{ prize: any; account: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean } }> = [];
        for (const { pubkey, account } of pgAccs) {
          try {
            const p: any = accountCoder.decode("PrizeItem", account.data);
            const boxPk = p.boxConfig ?? p.box_config;
            if (boxPk && boxPk.equals(boxConfigPubkey)) {
              let prize_type: "Sol" | "SplToken" | "Nft" = "SplToken";
              const rawType = p.prize_type ?? p.prizeType;
              if (typeof rawType === "number") {
                if (rawType === 0) prize_type = "Sol";
                else if (rawType === 1) prize_type = "SplToken";
                else if (rawType === 2) prize_type = "Nft";
              } else if (typeof rawType === "object" && rawType !== null) {
                const keys = Object.keys(rawType).map(k => k.toLowerCase());
                if (keys.includes("sol")) prize_type = "Sol";
                else if (keys.includes("spltoken") || keys.includes("token")) prize_type = "SplToken";
                else if (keys.includes("nft")) prize_type = "Nft";
              }

              const amtRaw = p.amount;
              const amountNum = typeof amtRaw === 'string' 
                ? BigInt(amtRaw.startsWith('0x') ? amtRaw : `0x${amtRaw}`)
                : typeof amtRaw === 'bigint'
                  ? amtRaw
                  : BigInt(Number(amtRaw) || 0);
                  
              const tmRaw = p.token_mint ?? p.tokenMint;
              const tokenMintStr = tmRaw?.toBase58?.() || String(tmRaw);
              
              combinedPrizes.push({
                prize: {
                  index: p.index,
                  prize_type,
                  token_mint: tokenMintStr,
                  amount: amountNum,
                  win_percentage: p.win_percentage ?? p.winPercentage,
                  total_count: p.total_count ?? p.totalCount,
                  claimed_count: p.claimed_count ?? p.claimedCount,
                },
                account: {
                  pubkey,
                  isSigner: false,
                  isWritable: true,
                }
              });
            }
          } catch {}
        }
        combinedPrizes.sort((a, b) => a.prize.index - b.prize.index);
        const prizeItems = combinedPrizes.map(x => x.prize);
        const prizeItemAccounts = combinedPrizes.map(x => x.account);

        const tx = new Transaction();

        // Collect ALL unique non-SOL prize mints so we can handle any prize the user might win
        const tokenPrizes = prizeItems.filter(p => p.prize_type === "SplToken" || p.prize_type === "Nft");
        const uniquePrizeMints = [...new Set(tokenPrizes.map(p => p.token_mint))]
          .filter(m => m && m !== "11111111111111111111111111111111");
        
        const tokenProgram = uniquePrizeMints.length > 0
          ? new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
          : undefined;

        // Add open_box instruction to buy and reveal instantly in a single transaction
        const openIx = ixOpenBox(
          platformPubkey,
          projectPubkey,
          boxConfigPubkey,
          receiptPk,
          vaultPubkey,
          wallet.publicKey,
          feeWalletPk,
          tenantPk,
          slug,
          Number(realBoxId),
          qty,
          prizeItemAccounts
        );
        tx.add(openIx);

        tx.feePayer = wallet.publicKey || undefined;
        const { blockhash } = await retryWithBackoff(
          () => conn.getLatestBlockhash("confirmed"),
          "getLatestBlockhash",
        ) as { blockhash: string };
        tx.recentBlockhash = blockhash;

        setConfirmMessage("Submitting transaction to wallet...");
        if (!wallet.signTransaction) throw new Error("Wallet does not support transaction signing");
        const signed = await wallet.signTransaction(tx);
        setConfirmMessage("Broadcasting transaction to Solana...");
        sig = await retryWithBackoff(
          () => conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" }),
          "sendRawTransaction",
        );
        setConfirmMessage("Confirming transaction on-chain...");
        await retryWithBackoff(
          () => conn.confirmTransaction(sig, "confirmed"),
          "confirmTransaction",
        );

        setConfirmMessage("Fetching box reward details...");
        let logs: string[] = [];
        let txDetails: any = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            txDetails = await conn.getTransaction(sig, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0
            });
            if (txDetails) break;
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (txDetails?.meta) {
          logs = txDetails.meta.logMessages || [];
        }

        revealSig = sig;
        let revealed = true;

      const rewardsList: any[] = [];

      if (!revealed) {
        console.warn("[OpenBox] Polling/Reveal timed out. Falling back to default success state.");
      } else {
        // If we don't have logs yet (because we polled on-chain), fetch the latest transaction details
        if (logs.length === 0) {
          try {
            setConfirmMessage("Fetching box reward details...");
            const signatures = await conn.getSignaturesForAddress(receiptPk, { limit: 1 });
            if (signatures.length > 0) {
              revealSig = signatures[0].signature;
              console.log("[OpenBox] Found reveal transaction signature:", revealSig);
              
              let revealTxDetails: any = null;
              for (let attempt = 0; attempt < 5; attempt++) {
                try {
                  revealTxDetails = await conn.getTransaction(revealSig, {
                    commitment: "confirmed",
                    maxSupportedTransactionVersion: 0
                  });
                  if (revealTxDetails) break;
                } catch {}
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              if (revealTxDetails?.meta) {
                logs = revealTxDetails.meta.logMessages || [];
              }
            }
          } catch (e) {
            console.error("[OpenBox] Failed to fetch reveal transaction logs:", e);
          }
        }

        try {
          if (logs.length > 0) {
            const eventCoder = new BorshEventCoder(IDL as any);
            const fullCoder = new BorshCoder(IDL as any);
            
            let parsedEvents: any[] = [];
            try {
              const parser = new EventParser(PGID, fullCoder);
              parsedEvents = Array.from(parser.parseLogs(logs))
                .filter(e => e.name === "BoxOpenEvent")
                .map(e => e.data);
            } catch (err) {
              console.warn("EventParser failed, trying manual fallback:", err);
            }
            
            if (parsedEvents.length === 0) {
              for (const log of logs) {
                if (log.includes("Program data:")) {
                  try {
                    const dataIndex = log.indexOf("Program data:");
                    const eventLog = log.slice(dataIndex);
                    const ev = eventCoder.decode(eventLog);
                    if (ev && ev.name === "BoxOpenEvent") {
                      parsedEvents.push(ev.data);
                    }
                  } catch {}
                }
              }
            }
            
            console.log("[OpenBox] Parsed reveal events:", parsedEvents);
              
              for (const wonEvent of parsedEvents) {
                console.log("[MysteryBox] Processing wonEvent:", JSON.stringify(wonEvent, bigIntReplacer, 2));
                const wonVal = wonEvent.won ?? wonEvent.Won;
                if (wonVal) {
                  const pType = wonEvent.prize_type ?? wonEvent.prizeType;
                  let isSol = false;
                  let isNft = false;
                  let isToken = false;
                  
                  if (typeof pType === 'number') {
                    isSol = pType === 0;
                    isToken = pType === 1;
                    isNft = pType === 2;
                  } else if (pType && typeof pType === 'object') {
                    const keys = Object.keys(pType).map(k => k.toLowerCase());
                    isSol = keys.includes('sol');
                    isToken = keys.includes('spltoken') || keys.includes('token');
                    isNft = keys.includes('nft');
                  }
                  
                  const amountWonRaw = wonEvent.amount_won ?? wonEvent.amountWon;
                  console.log("[OpenBox] amountWonRaw:", amountWonRaw);
                  
                  let amountWon: number;
                  if (typeof amountWonRaw === 'string' && /^[0-9a-fA-F]+$/.test(amountWonRaw)) {
                    amountWon = parseInt(amountWonRaw, 16);
                  } else if (amountWonRaw?.toNumber) {
                    amountWon = amountWonRaw.toNumber();
                  } else {
                    amountWon = Number(amountWonRaw ?? 0);
                  }
                  
                  console.log("[OpenBox] amountWon:", amountWon);
                  
                  const tokenMintRaw = wonEvent.token_mint ?? wonEvent.tokenMint;
                  const mintStr = tokenMintRaw?.toBase58?.() ?? "";
                  
                  if (isSol) {
                    const solReward = {
                      name: amountWon <= 0 ? "Nothing" : "Solana (SOL)",
                      amount: amountWon / 1e9,
                      image: amountWon <= 0 ? "🎁" : "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
                      isSol: true,
                      isNFT: false,
                      symbol: "SOL"
                    };
                    rewardsList.push(solReward);
                  } else {
                    const matchingAsset = vaultAssets.find(a => a.mint === mintStr);
                    if (matchingAsset) {
                      rewardsList.push({
                        name: matchingAsset.name,
                        amount: amountWon / Math.pow(10, matchingAsset.decimals),
                        image: matchingAsset.image || "🎁",
                        isNFT: matchingAsset.isNFT || isNft,
                        isSol: false,
                        symbol: matchingAsset.symbol || matchingAsset.name.slice(0, 5).toUpperCase()
                      });
                    } else {
                      let fetchedMeta: Partial<AssetInfo> = {};
                      try {
                        fetchedMeta = await fetchAssetMetadata(mintStr, RPC);
                      } catch (err) {
                        console.warn("Failed to fetch individual asset metadata:", err);
                      }
                      
                      const name = fetchedMeta.name || (isNft ? `NFT (${mintStr.slice(0, 4)}…${mintStr.slice(-4)})` : mintStr.startsWith("EPjF") ? "USDC" : `Token (${mintStr.slice(0, 4)}…${mintStr.slice(-4)})`);
                      const decimals = fetchedMeta.decimals ?? (mintStr.startsWith("EPjF") ? 6 : 9);
                      const isAssetNFT = fetchedMeta.isNFT ?? isNft;
                      const image = fetchedMeta.image || (mintStr.startsWith("EPjF")
                        ? "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v/logo.png"
                        : "🎁");
                      const symbol = fetchedMeta.symbol || (mintStr.startsWith("EPjF") ? "USDC" : name.slice(0, 5).toUpperCase());
                      
                      rewardsList.push({
                        name,
                        amount: amountWon / Math.pow(10, decimals),
                        image,
                        isNFT: isAssetNFT,
                        isSol: false,
                        symbol
                      });
                    }
                  }
                } else {
                  rewardsList.push({
                    name: "Better luck next time!",
                    amount: 0,
                    image: "🎁",
                    isSol: false,
                    isNFT: false
                  });
                }
            }
          }
        } catch (e) {
          console.error("[OpenBox] Failed to fetch won rewards details:", e);
        }
      }

      console.log("[OpenBox] Setting wonRewards (JSON):", JSON.stringify(rewardsList, bigIntReplacer, 2));
      
      setWonRewards(rewardsList);
      const finalSig = revealSig || sig;
      setTxSig(finalSig);

      // Record leaderboard off-chain in background (do not block UI on failure)
      fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          sig: finalSig,
          user: wallet.publicKey.toBase58(),
          boxConfig: boxConfigPubkey.toBase58(),
          isSolBox: isPaySol,
          timestamp: Math.floor(Date.now() / 1000),
          wonRewards: rewardsList
        })
      }).catch(err => console.error("[Leaderboard] Error recording event:", err));
      
      // Wait 100ms then set phase to success to make sure wonRewards is set first!
      setTimeout(() => {
        console.log("[OpenBox] Setting phase to success");
        setPhase("success");
        toast.success(`${qty} pack${qty > 1 ? "s" : ""} opened successfully!`);
      }, 100);
    } catch (e: unknown) {
      console.log("[OpenBox Error]", e);
      if (e instanceof SendTransactionError) {
        try {
          const logs = await e.getLogs(conn);
          Object.defineProperty(e, "logs", { value: logs, configurable: true, writable: true });
          console.error("[OpenBox SendTransactionError Logs]", logs);
        } catch (logErr) {
          console.error("Failed to retrieve SendTransactionError logs:", logErr);
        }
      } else if (e && typeof (e as any).getLogs === "function") {
        try {
          console.error("[OpenBox Error Logs]", (e as any).getLogs());
        } catch {}
      }
      console.log("[OpenBox Error Details]", JSON.stringify(e, null, 2));
      const msg = parseSolanaError(e);
      setErrMsg(msg);
      setPhase("error");
      toast.error(msg);
    }
  }, [wallet, box, slug, qty, vaultAssets, selectedPayIndex, payOptions]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/85 backdrop-blur-xl"
        onClick={phase === "select" || phase === "success" || phase === "error" ? onClose : undefined}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />

      {/* Modal */}
      <motion.div
        className="relative w-full max-w-md rounded-3xl border border-[#1cac64]/12
          bg-gradient-to-b from-[#ffffff] to-[#f4fef0] shadow-[0_0_80px_rgba(0,0,0,0.8)] max-h-[90vh] overflow-y-auto"
        initial={{ scale: 0.9, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, y: 30, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 h-8 w-8 rounded-full bg-[#1cac64]/6 border border-white/[0.1]
            flex items-center justify-center text-[#2d5a3f] hover:text-[#0f2618] hover:bg-white/[0.1] transition-all text-sm cursor-pointer"
        >✕</button>

        {/* ── SELECT PHASE ── */}
        {phase === "select" && (
          <div className="p-6 space-y-5">
            {/* Box preview */}
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 rounded-2xl overflow-hidden border border-[#1cac64]/12 shrink-0 bg-[#111]">
                {box.bannerUri ? (
                  <img src={resolveIpfsUrl(box.bannerUri)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">🎁</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-[#0f2618] truncate">{box.name || `Pack #${box.boxId}`}</h3>
                <p className="text-xs text-[#3d6b4e] mt-0.5">
                  {remaining} remaining · {formattedPrice} {selectedOption.symbol} each
                </p>
              </div>
            </div>

            {/* Quantity selector */}
            <div>
              <label className="text-xs text-[#2d5a3f] font-semibold uppercase tracking-wider block mb-3">
                How many packs?
              </label>
              <div className={`grid gap-2 ${
                qtyOptions.length === 3 ? "grid-cols-3" :
                qtyOptions.length === 2 ? "grid-cols-2" : "grid-cols-1"
              }`}>
                {qtyOptions.map(n => (
                  <motion.button
                    key={n}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setQty(n)}
                    className={`py-3 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer ${
                      qty === n
                        ? "bg-[#1cac64] text-black shadow-[0_0_20px_rgba(28,172,100,0.3)]"
                        : "bg-[#1cac64]/5 text-[#1a3a2a] border border-[#1cac64]/12 hover:border-[#1cac64]/25 hover:bg-[#1cac64]/6"
                    }`}
                  >
                    {n}x
                  </motion.button>
                ))}
              </div>
              {maxQty > 0 && !qtyOptions.includes(maxQty) && maxQty > 1 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] text-[#4a7d5e]">Custom:</span>
                  <input
                    type="number"
                    min={1}
                    max={maxQty}
                    value={qty}
                    onChange={e => setQty(Math.max(1, Math.min(maxQty, parseInt(e.target.value) || 1)))}
                    className="w-20 bg-[#1cac64]/5 border border-[#1cac64]/12 rounded-lg px-2.5 py-1.5 text-xs text-[#0f2618]
                      focus:outline-none focus:border-[#1cac64]/40 transition"
                  />
                </div>
              )}
            </div>

            {/* Payment Token Selector */}
            {payOptions.length > 1 && (
              <div>
                <label className="text-xs text-[#2d5a3f] font-semibold uppercase tracking-wider block mb-2.5">
                  Pay with
                </label>
                <div className="flex flex-col gap-2">
                  {payOptions.map((opt, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedPayIndex(idx)}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-300 cursor-pointer ${
                        selectedPayIndex === idx
                          ? "bg-[#1cac64]/5 border-[#1cac64] text-[#0f2618] shadow-[0_0_20px_rgba(28,172,100,0.05)]"
                          : "bg-white/[0.01] border-[#1cac64]/10 text-[#2d5a3f] hover:border-white/[0.15] hover:text-[#1a3a2a]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-7 rounded-full bg-[#ebfde3]/60 flex items-center justify-center border border-[#1cac64]/12 shrink-0">
                          {opt.image && opt.image !== "🎁" ? (
                            <img src={resolveIpfsUrl(opt.image)} alt={opt.symbol} className="h-full w-full object-contain rounded-full" />
                          ) : (
                            <span className="text-sm">🎁</span>
                          )}
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-bold leading-tight">{opt.name}</p>
                          <p className="text-[10px] text-[#3d6b4e] mt-0.5">{opt.symbol}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono font-bold">{(opt.price / Math.pow(10, opt.decimals)).toFixed(4)} {opt.symbol}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Price breakdown */}
            <div className="bg-[#1cac64]/3 border border-[#1cac64]/10 rounded-2xl p-4 space-y-2.5">
              <div className="flex justify-between text-xs">
                <span className="text-[#3d6b4e]">Price per pack</span>
                <span className="text-[#1a3a2a] font-mono">{formattedPrice} {selectedOption.symbol}</span>
              </div>
              {platformFeeLamports > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#3d6b4e]">Platform Fee per pack</span>
                  <span className="text-[#1a3a2a] font-mono">{(platformFeeLamports / 1e9).toFixed(4)} SOL</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-[#3d6b4e]">Quantity</span>
                <span className="text-[#1a3a2a] font-mono">× {qty}</span>
              </div>
              <div className="h-px bg-[#1cac64]/6" />
              {isPaySol ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#2d5a3f] font-semibold">Box Price</span>
                    <span className="text-[#0f2618] font-mono font-bold">
                      {(totalCost / 1e9).toFixed(4)}{" "}
                      <span className="text-[#3d6b4e] text-xs font-sans font-normal">SOL</span>
                    </span>
                  </div>
                  {totalSolFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[#2d5a3f] font-semibold">Platform Fee</span>
                      <span className="text-[#0f2618] font-mono font-bold">
                        {(totalSolFee / 1e9).toFixed(4)}{" "}
                        <span className="text-[#3d6b4e] text-xs font-sans font-normal">SOL</span>
                      </span>
                    </div>
                  )}
                  <div className="h-px bg-[#1cac64]/6 my-1.5" />
                  <div className="flex justify-between text-sm">
                    <span className="text-[#0f2618] font-bold">Total</span>
                    <span className="text-[#1cac64] font-mono font-bold">
                      {((totalCost + totalSolFee) / 1e9).toFixed(4)}{" "}
                      <span className="text-[#2d5a3f] text-xs font-sans font-normal">SOL</span>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#2d5a3f] font-semibold">Total Price</span>
                    <span className="text-[#0f2618] font-mono font-bold">
                      {formattedTotal}{" "}
                      <span className="text-[#3d6b4e] text-xs font-sans font-normal">{selectedOption.symbol}</span>
                    </span>
                  </div>
                  {totalSolFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[#2d5a3f] font-semibold">Total Platform Fee</span>
                      <span className="text-[#0f2618] font-mono font-bold">
                        {formattedSolFee}{" "}
                        <span className="text-[#3d6b4e] text-xs font-sans font-normal">SOL</span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* CTA */}
            {!wallet.connected ? (
              <div className="text-center py-3 rounded-xl bg-[#1cac64]/4 border border-[#1cac64]/10 text-xs text-[#3d6b4e]">
                Connect your wallet to open packs
              </div>
            ) : !active ? (
              <div className="text-center py-3 rounded-xl bg-[#1cac64]/4 border border-[#1cac64]/10 text-xs text-[#3d6b4e]">
                This pack is currently unavailable
              </div>
            ) : remaining <= 0 ? (
              <div className="text-center py-3 rounded-xl bg-[#1cac64]/4 border border-[#1cac64]/10 text-xs text-[#3d6b4e]">
                Sold out
              </div>
            ) : (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleOpen}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#1cac64] to-emerald-400 text-black text-sm font-bold
                  shadow-[0_0_25px_rgba(28,172,100,0.3)] hover:shadow-[0_0_45px_rgba(28,172,100,0.5)] transition-shadow duration-500 cursor-pointer"
              >
                Open {qty} Pack{qty > 1 ? "s" : ""} — {isPaySol ? ((totalCost + totalSolFee) / 1e9).toFixed(4) : formattedTotal} {selectedOption.symbol}
              </motion.button>
            )}
          </div>
        )}

        {/* ── SIGNING / CONFIRMING PHASE ── */}
        {(phase === "signing" || phase === "confirming") && (
          <div className="p-8 flex flex-col items-center gap-5">
            {/* Animated box */}
            <motion.div
              className="relative h-32 w-24 rounded-3xl bg-[#1cac64]/3 border border-[#1cac64]/12 flex items-center justify-center overflow-hidden"
              animate={{ rotateY: [0, 10, -10, 0], scale: [1, 1.02, 0.98, 1] }}
              transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="Project Logo" className="w-16 h-16 object-contain rounded-xl" />
              ) : (
                <span className="text-4xl">🎁</span>
              )}
            </motion.div>

            <div className="text-center">
              <p className="text-xs text-[#1cac64]/60 uppercase tracking-widest mb-1.5 font-semibold">
                {phase === "signing" ? "Waiting for Signature" : "Confirming Transaction"}
              </p>
              <h3 className="text-xl font-bold text-[#0f2618]">
                Opening {qty} Pack{qty > 1 ? "s" : ""}
              </h3>
              <p className="text-xs text-[#3d6b4e] mt-2 max-w-xs">
                {phase === "signing"
                  ? "Please approve the transaction in your wallet."
                  : confirmMessage}
              </p>
            </div>

            {/* Loader */}
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="w-2 h-2 rounded-full bg-[#1cac64]"
                  animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                  transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── SUCCESS PHASE ── */}
        {phase === "success" && (
          <div className="p-6 flex flex-col items-center gap-4">
            {(() => { console.log("[OpenBox] Rendering success phase! wonRewardsRef:", wonRewardsRef.current); return null; })()}
            {/* Won Reward display */}
            {wonRewards && wonRewards.length > 0 ? (
              <div className="w-full space-y-4 max-h-[220px] overflow-y-auto pr-1">
                <div className="text-xs text-[#1cac64] font-black uppercase tracking-widest text-center animate-pulse mb-3">You Won!</div>
                <div className={`grid gap-3 ${wonRewards.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {wonRewards.map((reward, i) => (
                    <motion.div
                      key={i}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", damping: 15, delay: i * 0.08 }}
                      className="flex flex-col items-center p-3 rounded-2xl bg-[#1cac64]/3 border border-[#1cac64]/15 space-y-2 shadow-[0_0_20px_rgba(28,172,100,0.02)]"
                    >
                      {/* Reward Image */}
                      <div className="relative h-16 w-16 rounded-xl overflow-hidden border border-[#1cac64]/20 bg-black/60 flex items-center justify-center shrink-0">
                        {reward.image && reward.image !== "🎁" ? (
                          <img src={resolveIpfsUrl(reward.image)} alt={reward.name} className="w-full h-full object-cover" />
                        ) : (
                          reward.amount <= 0 && !reward.isNFT ? (
                            branding.nothingRewardImage && branding.nothingRewardImage !== "🎁" ? (
                              <img src={resolveIpfsUrl(branding.nothingRewardImage)} alt={reward.name} className="w-full h-full object-cover" />
                            ) : branding.nothingRewardImage === "🎁" ? (
                              <span className="text-2xl select-none">🎁</span>
                            ) : (
                              <img src="/nothing.png" alt={reward.name} className="w-full h-full object-cover" />
                            )
                          ) : (
                            <span className="text-2xl select-none">🎁</span>
                          )
                        )}
                      </div>

                      {/* Reward Details */}
                      <div className="text-center space-y-0.5 min-w-0 w-full">
                        <h4 className="text-xs font-bold text-[#0f2618] truncate max-w-full leading-tight">{reward.name}</h4>
                        <p className="text-[10px] font-mono font-bold text-[#1cac64]">
                          {reward.isNFT ? "1x NFT" : reward.amount > 0 ? `+${reward.amount.toFixed(4)} ${reward.symbol || (reward.isSol ? "SOL" : "Tokens")}` : "No win"}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : (
              /* Celebration */
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", damping: 12, stiffness: 200 }}
                className="relative h-28 w-28 rounded-full bg-gradient-to-br from-[#1cac64]/20 to-emerald-500/10
                  border-2 border-[#1cac64]/30 flex items-center justify-center"
              >
                <span className="absolute -inset-4 rounded-full bg-[#1cac64]/10 blur-2xl -z-10 animate-pulse" />
                <span className="text-5xl">🎉</span>
              </motion.div>
            )}

            <div className="text-center">
              <motion.h3
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-xl font-black text-[#0f2618]"
              >
                Pack{qty > 1 ? "s" : ""} Opened!
              </motion.h3>
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-xs text-[#2d5a3f] mt-1.5"
              >
                {qty} pack{qty > 1 ? "s" : ""} opened successfully
              </motion.p>
            </div>

            {/* Transaction signature */}
            {txSig && (
              <motion.div
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="w-full bg-[#1cac64]/4 border border-[#1cac64]/12 rounded-2xl p-4 space-y-2"
              >
                <p className="text-[10px] text-[#3d6b4e] uppercase tracking-wider font-semibold">Transaction Signature</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-[#1cac64] break-all select-all">{shortenSig(txSig)}</code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(txSig); toast.success("Copied!"); }}
                    className="text-[#2d5a3f] hover:text-[#0f2618] text-xs p-1.5 rounded-lg hover:bg-[#1cac64]/6 transition cursor-pointer shrink-0"
                    title="Copy full signature"
                  >📋</button>
                </div>
                <a
                  href={`${EXPLORER_BASE}/${txSig}${CLUSTER_PARAM}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[#1cac64]/70 hover:text-[#1cac64] transition mt-1"
                >
                  View on Solana Explorer
                  <span className="text-[10px]">↗</span>
                </a>
              </motion.div>
            )}

            {/* Share on X Button */}
            {wonRewards && wonRewards.length > 0 && (
              <motion.button
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.45 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  const rewardNames = wonRewards.map(r => {
                    const cleanAmount = r.amount > 0 ? r.amount.toFixed(2).replace(/\.00$/, '') : '';
                    return `${r.isNFT ? '1x' : cleanAmount ? cleanAmount : ''} ${r.name}`;
                  }).join(", ");
                  const shareUrl = window.location.href;
                  const twitterHandle = branding.twitterUsername || "";
                  const tagText = twitterHandle ? `@${twitterHandle.replace('@', '')} ` : "";
                  const rewardImg = wonRewards[0]?.image && wonRewards[0]?.image !== "🎁" ? resolveIpfsUrl(wonRewards[0].image) : "";
                  
                  let tweetText = `I just won ${rewardNames} in a mystery box drop by ${branding.name || slug} on Geckura! 🦎🎁\n\n`;
                  if (rewardImg) {
                    tweetText += `Reward image: ${rewardImg}\n`;
                  }
                  tweetText += `Open yours here: ${shareUrl}\n\n${tagText}#Solana #MysteryBox @geckura`;
                  
                  const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
                  window.open(intentUrl, "_blank", "noopener,noreferrer");
                }}
                className="w-full py-3 rounded-xl bg-[#1da1f2] hover:bg-[#1a91da] text-white text-sm font-bold flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(29,161,242,0.3)] transition-all cursor-pointer"
              >
                <span>Share on X</span>
                <span className="text-base">𝕏</span>
              </motion.button>
            )}

            <motion.button
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-[#1cac64]/6 border border-white/[0.1] text-sm font-semibold text-[#1a3a2a]
                hover:bg-white/[0.1] hover:text-[#0f2618] transition-all cursor-pointer"
            >
              Done
            </motion.button>
          </div>
        )}

        {/* ── ERROR PHASE ── */}
        {phase === "error" && (
          <div className="p-8 flex flex-col items-center gap-5">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="h-20 w-20 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center"
            >
              <span className="text-4xl">❌</span>
            </motion.div>

            <div className="text-center">
              <h3 className="text-lg font-bold text-[#0f2618]">Transaction Failed</h3>
              <p className="text-xs text-[#3d6b4e] mt-1.5 max-w-xs break-words">{errMsg}</p>
            </div>

            <div className="flex gap-2 w-full">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setPhase("select")}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#1cac64] to-emerald-400 text-black text-sm font-bold transition cursor-pointer"
              >
                Try Again
              </motion.button>
              <button
                onClick={onClose}
                className="px-5 py-3 rounded-xl bg-[#1cac64]/6 border border-white/[0.1] text-sm text-[#2d5a3f]
                  hover:text-[#0f2618] transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SKELETON LOADER
═══════════════════════════════════════════════════════════════════════ */

function Skeleton() {
  return (
    <div className="min-h-screen gradient-bg">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        {/* Hero skeleton */}
        <div className="pt-12 pb-14 space-y-4">
          <div className="flex items-start gap-5">
            <div className="h-20 w-20 rounded-2xl skeleton shrink-0" />
            <div className="flex-1 space-y-3 pt-2">
              <div className="h-8 w-64 skeleton rounded-lg" />
              <div className="h-4 w-96 skeleton rounded" />
              <div className="flex gap-2 mt-2">
                <div className="h-7 w-32 skeleton rounded-full" />
                <div className="h-7 w-28 skeleton rounded-full" />
              </div>
            </div>
          </div>
        </div>
        {/* Grid skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl overflow-hidden border border-[#1cac64]/8">
              <div className="h-[108px] skeleton" />
              <div className="p-5 space-y-3">
                <div className="h-5 w-40 skeleton rounded" />
                <div className="h-3 w-full skeleton rounded" />
                <div className="h-1.5 skeleton rounded-full" />
                <div className="flex justify-between items-center pt-2">
                  <div className="h-8 w-24 skeleton rounded" />
                  <div className="h-9 w-28 skeleton rounded-xl" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
