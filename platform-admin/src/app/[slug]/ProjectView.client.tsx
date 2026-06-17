"use client";

import { useCallback, useEffect, useState, useMemo, useRef, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { PublicKey, Connection, SystemProgram, Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { retryWithBackoff, buildIx, boxStatusToCode, toUnixSeconds, platformPDA, projectPDA, boxPDA } from "@/lib/program-ix";
import { type LiveBox, useAppStore } from "@/lib/store";
import { useSetProjectBranding, useProjectBranding } from "@/lib/ProjectBrandingProvider";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createTransferInstruction } from "@solana/spl-token";
import toast from "react-hot-toast";
import { resolveIpfsUrl } from "@/lib/helpers";
import { BorshAccountsCoder, BorshCoder, BorshEventCoder, EventParser } from "@coral-xyz/anchor";
import IDL from "@/lib/idl.json";

const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
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
      <div className="ticker-anim flex gap-10 whitespace-nowrap text-xs text-gray-400">
        {doubled.map((t, i) => (
          <span key={i} className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#39ff14] opacity-70" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#39ff14]" />
            </span>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function parseSolanaError(err: any): string {
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
    }
  }

  // Fallback regex search within the stringified error object to catch logs if they were printed as string
  const stringified = JSON.stringify(err);
  const match = stringified.match(/Error Message:\s*([^"\\]+)/);
  if (match && match[1]) {
    return match[1].trim();
  }

  // Fallback exact mapping of standard program errors
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
    if (data.length < 307) return null;
    
    const nameBytes = data.slice(65, 65 + 32);
    const name = new TextDecoder().decode(nameBytes).replace(/\0/g, "").trim();
    
    const symbolBytes = data.slice(97, 97 + 10);
    const symbol = new TextDecoder().decode(symbolBytes).replace(/\0/g, "").trim();
    
    const uriBytes = data.slice(107, 107 + 200);
    const uri = new TextDecoder().decode(uriBytes).replace(/\0/g, "").trim();
    
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
  const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  
  const tokens = await retryWithBackoff(
    () => conn.getParsedTokenAccountsByOwner(ownerPk, { programId: tokenProg }),
    "getParsedTokenAccountsByOwner"
  );
  
  const parsedPromises = tokens.value.map(async (ta): Promise<AssetInfo | null> => {
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
              const res = await fetch(parsed.uri);
              if (res.ok) {
                const json = await res.json();
                image = json.image || image;
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

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

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

            if (typeof window !== "undefined") {
              const localBranding = localStorage.getItem(`project_branding_${slug}`);
              if (localBranding) {
                try {
                  const parsed = JSON.parse(localBranding);
                  decodedProject.name = decodedProject.name || parsed.name || "";
                  decodedProject.description = decodedProject.description || parsed.description || "";
                  decodedProject.logoUri = decodedProject.logoUri || parsed.logoUri || "";
                  decodedProject.bgUri = decodedProject.bgUri || parsed.bgUri || "";
                  decodedProject.themeColor = decodedProject.themeColor || parsed.themeColor || "";
                  decodedProject.nothingRewardImage = parsed.nothingRewardImage || "";
                } catch {}
              }
            }
          }
          
          console.log("[ProjectView] Decoded Project account:", decodedProject);
          setProject(decodedProject);
        } catch (e) { 
          console.warn("[ProjectView] Failed to decode Project account:", e);
          const fallback: any = { name: slug };
          if (typeof window !== "undefined") {
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
        if (typeof window !== "undefined") {
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
            if (typeof window !== "undefined") {
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

      // Fetch Prize Items for each box
      const prizeItemMap: Record<string, any[]> = {};
      setProgressMsg("Reading prize pool configurations...");
      // First fetch all program accounts once
      const allProgramAccounts = await retryWithBackoff(() => conn.getProgramAccounts(PGID), "getProgramAccounts(prizeItems)");
      
      for (const box of sortedBoxes) {
        try {
          const boxConfigPubkey = new PublicKey(box.pubkey);
          
          const boxPrizeItems: any[] = [];
          
          for (const { pubkey, account } of allProgramAccounts) {
            try {
              const p: any = coder.decode("PrizeItem", account.data);
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
                
                boxPrizeItems.push({
                  index: p.index,
                  prize_type,
                  token_mint: tokenMintStr,
                  amount: amountNum,
                  win_percentage: p.win_percentage ?? p.winPercentage,
                  total_count: p.total_count ?? p.totalCount,
                  claimed_count: p.claimed_count ?? p.claimedCount,
                });
              }
            } catch {}
          }
          boxPrizeItems.sort((a, b) => a.index - b.index);
          prizeItemMap[box.pubkey] = boxPrizeItems;
        } catch (e) {
          console.error(`Failed to fetch prize items for box ${box.boxId}:`, e);
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
        nothingRewardImage: resolveIpfsUrl((project.nothingRewardImage as string | null | undefined)) || null,
      });

      // Set page title
      document.title = `${name} | Mystery Box`;

      // Set favicon dynamically
      if (logoUri) {
        let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
        if (!link) {
          link = document.createElement("link");
          link.rel = "shortcut icon";
          document.getElementsByTagName("head")[0].appendChild(link);
        }
        link.href = logoUri;
      }
    }
  }, [project, slug, setBranding]);
  
  /* ── Fetch project + boxes ─────────────────────────────── */
  useEffect(() => {
    fetchProjectAndBoxes();
  }, [fetchProjectAndBoxes]);

  const [activeTab, setActiveTab] = useState<"active" | "expired">("active");
  const [selectedBoxForRewards, setSelectedBoxForRewards] = useState<LiveBox | null>(null);

  /* ── Render ─────────────────────────────────────────────── */
  const logoUri = resolveIpfsUrl((project.logoUri || project.logo_uri || project.logo_url) as string | undefined) || undefined;
  const themeColor = (project.themeColor || project.theme_color) as string | undefined;
  const bgUri   = resolveIpfsUrl((project.bgUri || project.bannerUri) as string | undefined) || undefined;
  const title   = (project.name as string) || slug;
  const desc    = (project.description as string) || "";

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

    const buttonClass = themeColor ? "!text-white hover:!opacity-95" : "!text-black hover:!bg-[#2ecc12]";
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
          className="max-w-md w-full bg-black/45 border border-white/[0.06] rounded-3xl p-8 backdrop-blur-xl space-y-6 shadow-2xl relative overflow-hidden ring-1 ring-white/10 transition-all duration-300"
        >
          <div 
            style={glowBgStyle}
            className="absolute inset-0 bg-gradient-to-br from-[#39ff14]/5 via-transparent to-transparent pointer-events-none" 
          />
          
          <div className="space-y-1.5 text-center">
            <h1 className="text-xl font-black text-white tracking-tight uppercase">{title} Mystery Box</h1>
            <p className="text-xs text-gray-500 font-medium">Connect wallet to get access</p>
          </div>
          
          <div className="flex justify-center pt-2">
            <WalletMultiButton 
              style={buttonStyle}
              className={`!bg-[#39ff14] hover:!scale-[1.02] ${buttonClass} !transition-all !rounded-xl !h-12 !px-6 !text-sm !font-bold shadow-[0_0_20px_rgba(57,255,20,0.25)]`} 
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
      borderTopColor: '#39ff14',
    };

    const textStyle = themeColor ? {
      color: themeColor,
    } : {
      color: '#39ff14',
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
        <div className="max-w-md w-full bg-black/45 border border-white/[0.06] rounded-3xl p-8 backdrop-blur-xl space-y-6 shadow-2xl relative overflow-hidden ring-1 ring-white/10">
          <div className="flex flex-col items-center justify-center py-12 space-y-5">
            <div 
              style={loaderStyle}
              className="h-10 w-10 border-2 border-white/10 rounded-full animate-spin shadow-[0_0_15px_rgba(255,255,255,0.02)]" 
            />
            <div className="space-y-1">
              <p className="text-xs text-gray-500 uppercase tracking-widest font-mono">Loading Storefront</p>
              <p 
                style={textStyle}
                className="text-sm font-semibold text-[#39ff14] animate-pulse"
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
      <div className="w-full bg-black/40 border-b border-white/[0.06] backdrop-blur-md relative z-40 overflow-hidden py-3">
        <Ticker items={winsToDisplay} />
      </div>

      <div className="flex-grow">
        <div className="relative overflow-hidden">

        {/* Subtle animated particles (CSS-based) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="absolute rounded-full bg-[#39ff14]/10 blur-xl float-anim"
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
          <div className="flex items-center justify-center">
            {desc && (
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="text-2xl sm:text-3xl font-semibold text-white max-w-3xl leading-snug text-center"
                style={{ textShadow: "0 2px 8px rgba(0,0,0,0.85)" }}
              >{desc}</motion.p>
            )}
          </div>
        </div>
      </div>

      {/* ═══ MYSTERY PACKS GRID ════════════════════════════════ */}
      <div className="mx-auto max-w-6xl px-5 sm:px-8 pb-20">

        {/* Section header with tabs */}
        <div className="flex items-center justify-center mb-6">
          <h2 className="text-lg font-bold text-white">Mystery Packs</h2>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-[#111]/50 rounded-2xl p-1 border border-white/[0.06] mx-auto max-w-xl">
          <button
            onClick={() => setActiveTab("active")}
            className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
              activeTab === "active"
                ? "bg-[#39ff14]/15 text-[#39ff14] border border-[#39ff14]/20"
                : "text-gray-500 hover:text-gray-400 hover:bg-white/[0.03]"
            }`}
          >
            Active Packs ({activeBoxes.length})
          </button>
          <button
            onClick={() => setActiveTab("expired")}
            className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
              activeTab === "expired"
                ? "bg-gray-500/10 text-gray-400 border border-gray-500/20"
                : "text-gray-500 hover:text-gray-400 hover:bg-white/[0.03]"
            }`}
          >
            Expired Packs ({endedBoxes.length})
          </button>
        </div>

        {currentBoxes.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="py-20 text-center rounded-3xl glass-panel"
          >
            <span className="text-5xl block mb-4">📦</span>
            <p className="text-gray-400 text-sm">
              {activeTab === "active" ? "No active packs available yet." : "No expired packs yet."}
            </p>
            <p className="text-gray-600 text-xs mt-1">Check back soon!</p>
          </motion.div>
        ) : (
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 ${activeTab === "expired" ? "opacity-60" : ""}`}>
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
            }}
            vaultAssets={vaultAssets}
            tokenMetaMap={tokenMetaMap}
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
              className="relative w-full max-w-lg mx-4 bg-[#111] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="p-6 border-b border-white/[0.06] flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {selectedBoxForRewards.name || `Pack #${selectedBoxForRewards.boxId}`}
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">Possible Rewards</p>
                </div>
                <button
                  onClick={() => setSelectedBoxForRewards(null)}
                  className="p-2 rounded-xl hover:bg-white/[0.06] transition-colors text-gray-400 hover:text-white"
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
                        <div key={idx} className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                          {displayImage && (displayImage.startsWith("http") || displayImage.startsWith("/")) ? (
                            <img
                              src={displayImage}
                              alt={displayName}
                              className="h-14 w-14 rounded-xl object-cover border border-white/[0.08]"
                            />
                          ) : (
                            <div className="h-14 w-14 rounded-xl border border-white/[0.08] bg-black/40 flex items-center justify-center text-2xl select-none">
                              {displayImage || "🎁"}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-bold text-white truncate">{displayName}</p>
                            <p className="text-sm text-gray-400 mt-1 font-mono">
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
                              <span className="text-[11px] px-3 py-1 rounded-full bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff14]/20 font-semibold">
                                {prize.win_percentage}% Chance
                              </span>
                              <span className="text-[11px] text-gray-500 font-medium">
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
                    <p className="text-gray-400 text-sm">No rewards listed yet</p>
                    <p className="text-gray-600 text-xs mt-2">Check back soon!</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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

/* ═══════════════════════════════════════════════════════════════════════
   BOX CARD — Premium card with hover effects & live data
═══════════════════════════════════════════════════════════════════════ */

function BoxCard({ box, index, onSelect, tokenMetaMap, onShowRewards }: { box: LiveBox; index: number; onSelect: () => void; tokenMetaMap: Record<string, { symbol: string; name: string; decimals: number; image: string; isNFT?: boolean }>; onShowRewards: () => void }) {
  const { connected }  = useWallet();
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
      : "bg-gray-500/12 text-gray-400 border-gray-500/20";
  } else {
    statusClass = active
      ? "bg-[#39ff14]/12 text-[#39ff14] border-[#39ff14]/20"
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
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-[#111]/80 border border-white/[0.06]
        hover:border-[#39ff14]/20 transition-all duration-500 card-hover"
    >
      {/* Banner */}
      <div className="relative h-36 overflow-hidden bg-gradient-to-br from-[#111] to-[#0a0a0a]">
        {box.bannerUri ? (
          <img src={resolveIpfsUrl(box.bannerUri)} alt={box.name}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl opacity-20 group-hover:opacity-30 transition-opacity duration-500">🎁</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#111] via-[#111]/30 to-transparent" />

        {/* Status badge */}
        <div className="absolute top-3 left-3">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border backdrop-blur-md ${statusClass}`}>
            {statusLabel}
          </span>
        </div>

        {/* Countdown timer */}
        {active && hasTime && hasStarted && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2">
            <motion.span 
              className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border bg-white/[0.08] text-gray-300 border-white/[0.12] flex items-center gap-1.5 cursor-default"
              whileHover={{ scale: 1.05, backgroundColor: "rgba(57, 255, 20, 0.15)", color: "#39ff14", borderColor: "rgba(57, 255, 20, 0.25)" }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#39ff14] animate-pulse" />
              {timeLeft(box.endTime)}
            </motion.span>
          </div>
        )}

        {/* Rewards Button */}
        <div className="absolute top-3 right-3">
          <motion.button
            onClick={(e) => { e.stopPropagation(); onShowRewards(); }}
            className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/[0.08] text-gray-300 border border-white/[0.12] hover:bg-[#39ff14]/15 hover:text-[#39ff14] hover:border-[#39ff14]/25 transition-all cursor-pointer"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Rewards
          </motion.button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-5 flex flex-col">
        <h3 className="text-base font-bold text-white leading-snug group-hover:text-[#39ff14] transition-colors duration-300">
          {box.name || `Pack #${box.boxId}`}
        </h3>
        {box.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{box.description}</p>
        )}

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-[11px] mb-1.5">
            <span className="text-gray-500">{sold} / {sup} opened</span>
            <span className={`font-mono font-semibold ${remaining <= 10 && active ? "text-amber-400" : remaining === 0 ? "text-red-400" : "text-[#39ff14]"}`}>
              {remaining > 0 ? `${remaining} left` : "Sold out"}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#39ff14] to-emerald-400"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, delay: index * 0.1 }}
            />
          </div>
        </div>

        {/* CTA & Accepted Currencies */}
        <div className="mt-4 flex items-center justify-between gap-4">
          {/* Accepted payment tokens */}
          {payOptions.length > 0 && (
            <div className="flex-1">
              <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mb-1">Accepted Currencies</p>
              <div className="flex flex-wrap gap-1.5">
                {payOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 bg-white/[0.02] border border-white/[0.06] rounded-xl px-2 py-0.5 hover:border-[#39ff14]/30 hover:bg-white/[0.04] transition duration-300">
                    <img src={resolveIpfsUrl(opt.image)} alt={opt.symbol} className="h-3 w-3 object-contain rounded-full border border-white/[0.08]" />
                    <span className="text-[9px] font-mono font-bold text-gray-300">
                      {(opt.price / Math.pow(10, opt.decimals)).toFixed(2)} <span className="text-gray-500 font-sans font-normal">{opt.symbol}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA Button */}
          <div>
            {!connected ? (
              <span className="text-[10px] text-gray-500 bg-white/[0.03] border border-white/[0.06] px-3 py-2 rounded-xl whitespace-nowrap">
                Connect wallet
              </span>
            ) : active && remaining > 0 && hasStarted ? (
              <motion.button
                onClick={(e) => { e.stopPropagation(); onSelect(); }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="text-xs font-bold text-black bg-gradient-to-r from-[#39ff14] to-emerald-400 px-4 py-2 rounded-xl whitespace-nowrap
                  shadow-[0_0_20px_rgba(57,255,20,0.25)] group-hover:shadow-[0_0_35px_rgba(57,255,20,0.4)] transition-shadow duration-500 cursor-pointer"
              >
                Open Pack
              </motion.button>
            ) : !hasStarted && active && remaining > 0 ? (
              <span className="text-[10px] text-purple-400 bg-purple-500/10 border border-purple-500/20 px-3 py-2 rounded-xl whitespace-nowrap">
                Starts soon
              </span>
            ) : (
              <span className="text-[10px] text-gray-500 bg-white/[0.03] border border-white/[0.06] px-3 py-2 rounded-xl whitespace-nowrap">
                Unavailable
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom glow line */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#39ff14]/20 to-transparent
        opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   OPEN BOX MODAL — Quantity selector, price breakdown, tx flow
═══════════════════════════════════════════════════════════════════════ */

function OpenBoxModal({ box, slug, onClose, vaultAssets, tokenMetaMap, project }: { box: LiveBox; slug: string; onClose: () => void; vaultAssets: AssetInfo[]; tokenMetaMap: Record<string, { symbol: string; name: string; decimals: number; image: string; isNFT?: boolean }>; project: any }) {
  const wallet = useWallet();
  const branding = useProjectBranding();
  const logoUrl = branding.logoUrl || resolveIpfsUrl((project?.logoUri || project?.logo_uri || project?.logo_url) as string | undefined) || undefined;
  const { addNotification } = useAppStore();
  const [qty, setQty]       = useState(1);
  const [phase, setPhase]   = useState<"select" | "signing" | "confirming" | "success" | "error">("select");
  const [txSig, setTxSig]   = useState("");
  const [errMsg, setErrMsg] = useState("");
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
      setPhase("signing"); setErrMsg(""); setWonRewards(null);
      const bigIntReplacer = (key: any, value: any) => 
        typeof value === 'bigint' ? value.toString() : value;
      try {
        const conn = new Connection(RPC, "confirmed");
        const boxConfigPk = new PublicKey(box.pubkey);

        /* Fetch Project account to read fee_wallet and tenant (authority) addresses required by buy_box */
        const projectPk = new PublicKey(box.project);
        const projectAcc = await retryWithBackoff(
          () => conn.getAccountInfo(projectPk),
          "getAccountInfo(project_fee_wallet)"
        );
        let feeWalletPk: PublicKey  = PGID;
        let tenantPk: PublicKey     = PGID;
        if (projectAcc) {
          const proj: any = new (BorshAccountsCoder as any)(IDL, PGID).decode("Project", projectAcc.data);
          const feeWalletVal = proj?.feeWallet ?? proj?.fee_wallet;
          feeWalletPk = feeWalletVal ? new PublicKey(feeWalletVal) : new PublicKey("11111111111111111111111111111111");
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
          [Buffer.from("receipt"), wallet.publicKey.toBuffer(), boxConfigPubkey.toBuffer()],
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

        // Pre-create user ATAs for ALL possible prize mints
        for (const mintStr of uniquePrizeMints) {
          const mint = new PublicKey(mintStr);
          const userAta = getAssociatedTokenAddressSync(mint, wallet.publicKey);
          const userAtaInfo = await conn.getAccountInfo(userAta);
          if (!userAtaInfo) {
            console.log(`[OpenBox] User ATA for ${mintStr.slice(0, 8)}… does not exist, adding create instruction...`);
            tx.add(createAssociatedTokenAccountInstruction(
              wallet.publicKey,
              userAta,
              wallet.publicKey,
              mint
            ));
          }
        }
        
        console.log("[OpenBox Debug] prizeItems:", JSON.stringify(prizeItems, bigIntReplacer, 2));
        console.log("[OpenBox Debug] uniquePrizeMints:", uniquePrizeMints);
        
        // 1. Add buy_box instruction to initialize the receipt and take payment
        const buyIx = buildIx("buy_box", {
          platform:      { pubkey: platformPubkey,             isSigner: false, isWritable: true  },
          project:       { pubkey: projectPubkey,              isSigner: false, isWritable: false },
          box_config:    { pubkey: boxConfigPubkey,            isSigner: false, isWritable: true  },
          receipt:       { pubkey: receiptPk,                  isSigner: false, isWritable: true  },
          user:          { pubkey: wallet.publicKey,           isSigner: true,  isWritable: false },
          fee_wallet:    { pubkey: feeWalletPk,                isSigner: false, isWritable: true  },
          tenant_wallet: { pubkey: tenantPk,                   isSigner: false, isWritable: true  },
          system_program: { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
        }, [slug, Number(realBoxId), qty]);
        tx.add(buyIx);

        // 2. Add request_open instruction for the total quantity
        const openIx = buildIx("request_open", {
          platform:       { pubkey: platformPubkey,             isSigner: false, isWritable: false },
          project:        { pubkey: projectPubkey,              isSigner: false, isWritable: false },
          box_config:     { pubkey: boxConfigPubkey,            isSigner: false, isWritable: false },
          receipt:        { pubkey: receiptPk,                  isSigner: false, isWritable: true  },
          user:           { pubkey: wallet.publicKey,           isSigner: true,  isWritable: false },
          system_program: { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
        }, [slug, Number(realBoxId), qty]);
        tx.add(openIx);

        tx.feePayer = wallet.publicKey;
        const { blockhash } = await retryWithBackoff(
          () => conn.getLatestBlockhash(),
          "getLatestBlockhash",
        ) as { blockhash: string };
        tx.recentBlockhash = blockhash;

      setPhase("confirming");
      const signed = await wallet.signTransaction(tx);
      const sig = await retryWithBackoff(
        () => conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" }),
        "sendRawTransaction",
      );
      await retryWithBackoff(
        () => conn.confirmTransaction(sig, "confirmed"),
        "confirmTransaction",
      );

      // Wait a brief moment and fetch full tx logs to parse Anchor events
      let txDetails: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          txDetails = await conn.getTransaction(sig as string, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0
          });
          if (txDetails) break;
        } catch {}
          await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const logs = txDetails?.meta?.logMessages || [];
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

      console.log("[MysteryBox] txLogs:", logs);
      console.log("[MysteryBox] parsedEvents count:", parsedEvents.length);
      console.log("[MysteryBox] parsedEvents:", JSON.stringify(parsedEvents, bigIntReplacer, 2));

      const rewardsList: any[] = [];
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
            // It's a hex string! Parse as little-endian hex to number!
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
            console.log("[OpenBox] Pushing SOL reward to rewardsList:", solReward);
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

      console.log("[OpenBox] Setting wonRewards (JSON):", JSON.stringify(rewardsList, bigIntReplacer, 2));
      
      // Set wonRewards first, no flushSync
      setWonRewards(rewardsList);
      setTxSig(sig as string);

      // Record leaderboard off-chain in background (do not block UI on failure)
      fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          sig: sig as string,
          user: wallet.publicKey.toBase58(),
          boxConfig: boxConfigPubkey.toBase58(),
          isSolBox: isPaySol,
          timestamp: Math.floor(Date.now() / 1000)
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
        className="relative w-full max-w-md rounded-3xl border border-white/[0.08]
          bg-gradient-to-b from-[#141414] to-[#0a0a0a] shadow-[0_0_80px_rgba(0,0,0,0.8)] max-h-[90vh] overflow-y-auto"
        initial={{ scale: 0.9, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, y: 30, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 h-8 w-8 rounded-full bg-white/[0.06] border border-white/[0.1]
            flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/[0.1] transition-all text-sm cursor-pointer"
        >✕</button>

        {/* ── SELECT PHASE ── */}
        {phase === "select" && (
          <div className="p-6 space-y-5">
            {/* Box preview */}
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 rounded-2xl overflow-hidden border border-white/[0.08] shrink-0 bg-[#111]">
                {box.bannerUri ? (
                  <img src={resolveIpfsUrl(box.bannerUri)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">🎁</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-white truncate">{box.name || `Pack #${box.boxId}`}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {remaining} remaining · {formattedPrice} {selectedOption.symbol} each
                </p>
              </div>
            </div>

            {/* Quantity selector */}
            <div>
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider block mb-3">
                How many packs?
              </label>
              <div className="grid grid-cols-4 gap-2">
                {qtyOptions.map(n => (
                  <motion.button
                    key={n}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setQty(n)}
                    className={`py-3 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer ${
                      qty === n
                        ? "bg-[#39ff14] text-black shadow-[0_0_20px_rgba(57,255,20,0.3)]"
                        : "bg-white/[0.04] text-gray-300 border border-white/[0.08] hover:border-[#39ff14]/25 hover:bg-white/[0.06]"
                    }`}
                  >
                    {n}x
                  </motion.button>
                ))}
              </div>
              {maxQty > 0 && !qtyOptions.includes(maxQty) && maxQty > 1 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] text-gray-600">Custom:</span>
                  <input
                    type="number"
                    min={1}
                    max={maxQty}
                    value={qty}
                    onChange={e => setQty(Math.max(1, Math.min(maxQty, parseInt(e.target.value) || 1)))}
                    className="w-20 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white
                      focus:outline-none focus:border-[#39ff14]/40 transition"
                  />
                </div>
              )}
            </div>

            {/* Payment Token Selector */}
            {payOptions.length > 1 && (
              <div>
                <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider block mb-2.5">
                  Pay with
                </label>
                <div className="flex flex-col gap-2">
                  {payOptions.map((opt, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedPayIndex(idx)}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-300 cursor-pointer ${
                        selectedPayIndex === idx
                          ? "bg-white/[0.04] border-[#39ff14] text-white shadow-[0_0_20px_rgba(57,255,20,0.05)]"
                          : "bg-white/[0.01] border-white/[0.06] text-gray-400 hover:border-white/[0.15] hover:text-gray-300"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-7 rounded-full bg-black/40 flex items-center justify-center border border-white/[0.08] shrink-0">
                          {opt.image && opt.image !== "🎁" ? (
                            <img src={resolveIpfsUrl(opt.image)} alt={opt.symbol} className="h-full w-full object-contain rounded-full" />
                          ) : (
                            <span className="text-sm">🎁</span>
                          )}
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-bold leading-tight">{opt.name}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5">{opt.symbol}</p>
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
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-4 space-y-2.5">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Price per pack</span>
                <span className="text-gray-300 font-mono">{formattedPrice} {selectedOption.symbol}</span>
              </div>
              {platformFeeLamports > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Platform Fee per pack</span>
                  <span className="text-gray-300 font-mono">{(platformFeeLamports / 1e9).toFixed(4)} SOL</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Quantity</span>
                <span className="text-gray-300 font-mono">× {qty}</span>
              </div>
              <div className="h-px bg-white/[0.06]" />
              {isPaySol ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400 font-semibold">Box Price</span>
                    <span className="text-white font-mono font-bold">
                      {(totalCost / 1e9).toFixed(4)}{" "}
                      <span className="text-gray-500 text-xs font-sans font-normal">SOL</span>
                    </span>
                  </div>
                  {totalSolFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400 font-semibold">Platform Fee</span>
                      <span className="text-white font-mono font-bold">
                        {(totalSolFee / 1e9).toFixed(4)}{" "}
                        <span className="text-gray-500 text-xs font-sans font-normal">SOL</span>
                      </span>
                    </div>
                  )}
                  <div className="h-px bg-white/[0.06] my-1.5" />
                  <div className="flex justify-between text-sm">
                    <span className="text-white font-bold">Total</span>
                    <span className="text-[#39ff14] font-mono font-bold">
                      {((totalCost + totalSolFee) / 1e9).toFixed(4)}{" "}
                      <span className="text-gray-400 text-xs font-sans font-normal">SOL</span>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400 font-semibold">Total Price</span>
                    <span className="text-white font-mono font-bold">
                      {formattedTotal}{" "}
                      <span className="text-gray-500 text-xs font-sans font-normal">{selectedOption.symbol}</span>
                    </span>
                  </div>
                  {totalSolFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400 font-semibold">Total Platform Fee</span>
                      <span className="text-white font-mono font-bold">
                        {formattedSolFee}{" "}
                        <span className="text-gray-500 text-xs font-sans font-normal">SOL</span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* CTA */}
            {!wallet.connected ? (
              <div className="text-center py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-gray-500">
                Connect your wallet to open packs
              </div>
            ) : !active ? (
              <div className="text-center py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-gray-500">
                This pack is currently unavailable
              </div>
            ) : remaining <= 0 ? (
              <div className="text-center py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-gray-500">
                Sold out
              </div>
            ) : (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleOpen}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#39ff14] to-emerald-400 text-black text-sm font-bold
                  shadow-[0_0_25px_rgba(57,255,20,0.3)] hover:shadow-[0_0_45px_rgba(57,255,20,0.5)] transition-shadow duration-500 cursor-pointer"
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
              className="relative h-32 w-24 rounded-3xl bg-white/[0.02] border border-white/[0.08] flex items-center justify-center overflow-hidden"
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
              <p className="text-xs text-[#39ff14]/60 uppercase tracking-widest mb-1.5 font-semibold">
                {phase === "signing" ? "Waiting for Signature" : "Confirming Transaction"}
              </p>
              <h3 className="text-xl font-bold text-white">
                Opening {qty} Pack{qty > 1 ? "s" : ""}
              </h3>
              <p className="text-xs text-gray-500 mt-2 max-w-xs">
                {phase === "signing"
                  ? "Please approve the transaction in your wallet."
                  : "Transaction submitted. Confirming on Solana…"}
              </p>
            </div>

            {/* Loader */}
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="w-2 h-2 rounded-full bg-[#39ff14]"
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
                <div className="text-xs text-[#39ff14] font-black uppercase tracking-widest text-center animate-pulse mb-3">You Won!</div>
                <div className={`grid gap-3 ${wonRewards.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {wonRewards.map((reward, i) => (
                    <motion.div
                      key={i}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", damping: 15, delay: i * 0.08 }}
                      className="flex flex-col items-center p-3 rounded-2xl bg-white/[0.02] border border-[#39ff14]/15 space-y-2 shadow-[0_0_20px_rgba(57,255,20,0.02)]"
                    >
                      {/* Reward Image */}
                      <div className="relative h-16 w-16 rounded-xl overflow-hidden border border-[#39ff14]/20 bg-black/60 flex items-center justify-center shrink-0">
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
                        <h4 className="text-xs font-bold text-white truncate max-w-full leading-tight">{reward.name}</h4>
                        <p className="text-[10px] font-mono font-bold text-[#39ff14]">
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
                className="relative h-28 w-28 rounded-full bg-gradient-to-br from-[#39ff14]/20 to-emerald-500/10
                  border-2 border-[#39ff14]/30 flex items-center justify-center"
              >
                <span className="absolute -inset-4 rounded-full bg-[#39ff14]/10 blur-2xl -z-10 animate-pulse" />
                <span className="text-5xl">🎉</span>
              </motion.div>
            )}

            <div className="text-center">
              <motion.h3
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-xl font-black text-white"
              >
                Pack{qty > 1 ? "s" : ""} Opened!
              </motion.h3>
              <motion.p
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-xs text-gray-400 mt-1.5"
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
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 space-y-2"
              >
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Transaction Signature</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-[#39ff14] break-all select-all">{shortenSig(txSig)}</code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(txSig); toast.success("Copied!"); }}
                    className="text-gray-400 hover:text-white text-xs p-1.5 rounded-lg hover:bg-white/[0.06] transition cursor-pointer shrink-0"
                    title="Copy full signature"
                  >📋</button>
                </div>
                <a
                  href={`${EXPLORER_BASE}/${txSig}${CLUSTER_PARAM}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[#39ff14]/70 hover:text-[#39ff14] transition mt-1"
                >
                  View on Solana Explorer
                  <span className="text-[10px]">↗</span>
                </a>
              </motion.div>
            )}

            <motion.button
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-white/[0.06] border border-white/[0.1] text-sm font-semibold text-gray-300
                hover:bg-white/[0.1] hover:text-white transition-all cursor-pointer"
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
              <h3 className="text-lg font-bold text-white">Transaction Failed</h3>
              <p className="text-xs text-gray-500 mt-1.5 max-w-xs break-words">{errMsg}</p>
            </div>

            <div className="flex gap-2 w-full">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setPhase("select")}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-[#39ff14] to-emerald-400 text-black text-sm font-bold transition cursor-pointer"
              >
                Try Again
              </motion.button>
              <button
                onClick={onClose}
                className="px-5 py-3 rounded-xl bg-white/[0.06] border border-white/[0.1] text-sm text-gray-400
                  hover:text-white transition cursor-pointer"
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
            <div key={i} className="rounded-2xl overflow-hidden border border-white/[0.04]">
              <div className="h-36 skeleton" />
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
