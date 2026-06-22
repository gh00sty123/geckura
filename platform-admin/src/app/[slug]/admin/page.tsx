"use client";

import { Suspense, useCallback, useEffect, use, useState, useMemo, useSyncExternalStore } from "react";
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { decodeAccount, fetchProjects, retryWithBackoff, ixInitializePlatform, platformPDA, sendIx, buildIx, getSolanaErrorDetails, boxStatusToCode, toUnixSeconds, unixToDatetimeLocal, datetimeLocalToUnix } from "@/lib/program-ix";
import { createBoxTx, createPrizeItemTx, createBoxWithPrizesTx, depositPrizeTx, withdrawPrizeTx, withdrawVaultSolTx, withdrawVaultTokenTx, closeVaultTokenAccountTx, updateProjectBrandingTx, migrateProjectToV2Tx } from "@/lib/actions";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createTransferInstruction } from "@solana/spl-token";
import { useSetProjectBranding } from "@/lib/ProjectBrandingProvider";
import toast from "react-hot-toast";
import { ImageUpload } from "@/components/ImageUpload";
import { ProjectBrandingModal } from "@/components/ProjectBrandingModal";
import { resolveIpfsUrl } from "@/lib/helpers";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import IDL from "@/lib/idl.json";
import { NETWORK } from "@/lib/env";

const TREASURY_WALLET = new PublicKey("FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq");

interface AssetInfo {
  ata: string;
  mint: string;
  uiAmount: number;
  decimals: number;
  isNFT: boolean;
  name: string;
  image?: string;
  symbol?: string;
}

// Fallback method using standard Solana JSON-RPC methods
async function fetchAssetsForOwnerFallback(ownerPk: PublicKey, rpcUrl: string): Promise<AssetInfo[]> {
  const conn = new Connection(rpcUrl, "confirmed");
  const tokenProg = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  
  const tokens = await retryWithBackoff(
    () => conn.getParsedTokenAccountsByOwner(ownerPk, { programId: tokenProg }),
    "getParsedTokenAccountsByOwner"
  );
  
  const parsed = tokens.value.map((ta): AssetInfo | null => {
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
    if (mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
      image = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png";
    }

    const name = isNFT 
      ? `NFT (${mint.slice(0, 4)}…${mint.slice(-4)})` 
      : mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" 
        ? "USDC" 
        : `Token (${mint.slice(0, 4)}…${mint.slice(-4)})`;

    return {
      ata: ta.pubkey.toBase58(),
      mint,
      uiAmount,
      decimals,
      isNFT,
      name,
      image
    };
  }).filter((t): t is AssetInfo => t !== null && t.uiAmount > 0);

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
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const json = await response.json();
    if (json.error) {
      throw new Error(json.error.message || JSON.stringify(json.error));
    }
    
    const items = json.result?.items || [];
    
    // If the node doesn't support getAssetsByOwner, it won't have standard result.items structure
    if (json.result === undefined && json.error) {
      throw new Error("Helius DAS not supported by this endpoint");
    }

    const assetPromises = items.map(async (item: any): Promise<AssetInfo> => {
      const mint = item.id;
      const decimals = item.token_info?.decimals ?? 0;
      const rawBalance = item.token_info?.balance ?? 0;
      const uiAmount = decimals > 0 ? (rawBalance / Math.pow(10, decimals)) : rawBalance;
      
      const isNFT = item.interface === "V1_NFT" || 
                    item.interface === "ProgrammableNFT" || 
                    item.interface === "NFT" || 
                    decimals === 0;

      // Extract image
      let image = "";
      if (item.content?.links?.image) {
        image = item.content.links.image;
      } else if (item.content?.files && item.content.files.length > 0) {
        const imgFile = item.content.files.find((f: any) => f.mime?.startsWith("image/") || f.type?.startsWith("image/"));
        if (imgFile?.uri) {
          image = imgFile.uri;
        } else if (item.content.files[0]?.uri) {
          image = item.content.files[0].uri;
        }
      }

      if (!image && item.content?.json_uri) {
        try {
          const res = await fetch(item.content.json_uri);
          if (res.ok) {
            const resJson = await res.json();
            image = resJson.image || "";
          }
        } catch {}
      }

      // Fallbacks for common token images if Helius didn't return one
      if (!image) {
        if (mint === "EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v") {
          image = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v/logo.png";
        }
      }

      // Name & Symbol
      const symbol = item.token_info?.symbol || item.content?.metadata?.symbol || "";
      const name = item.content?.metadata?.name || 
                   (isNFT 
                     ? `NFT (${mint.slice(0, 4)}…${mint.slice(-4)})` 
                     : symbol 
                       ? symbol 
                       : `Token (${mint.slice(0, 4)}…${mint.slice(-4)})`
                   );

      // Associated Token Account for the owner
      const ata = getAssociatedTokenAddressSync(new PublicKey(mint), ownerPk, true).toBase58();

      return {
        ata,
        mint,
        uiAmount,
        decimals,
        isNFT,
        name,
        image,
        symbol
      };
    });

    const assets = (await Promise.all(assetPromises)).filter((t: AssetInfo) => t.uiAmount > 0);
    return assets;
  } catch (e) {
    console.warn("Helius DAS fetch failed, falling back to standard RPC:", e);
    return fetchAssetsForOwnerFallback(ownerPk, rpcUrl);
  }
}

// React component to render asset images with fallback
function AssetAvatar({ asset }: { asset: any }) {
  const [imgFailed, setImgFailed] = useState(!asset.image);
  const isNFT = asset.isNFT;

  if (!imgFailed && asset.image) {
    return (
      <img 
        src={asset.image} 
        alt={asset.name} 
        className={`w-8 h-8 object-cover ${isNFT ? 'rounded-lg' : 'rounded-full'} border border-[#1cac64]/20 shrink-0 bg-[#d9f5cc]`}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div className={`w-8 h-8 flex items-center justify-center text-sm shrink-0 shadow-inner ${isNFT ? 'rounded-lg bg-indigo-950/40 text-indigo-400 border border-indigo-500/25' : 'rounded-full bg-[#d9f5cc] text-[#2d5a3f] border border-[#1cac64]/20'}`}>
      {isNFT ? '🎨' : '🪙'}
    </div>
  );
}

export default function ProjectAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <Suspense fallback={<div className="p-6 text-[#3d6b4e] animate-pulse">Loading project…</div>}>
      <Inner slug={slug} />
    </Suspense>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   PROJECT ADMIN  —  /[slug]/admin
   Per-project box manager: create/edit/close boxes, status, pricing, timing.
   Not accessible from /admin — only from /xoxo/admin via the public page.
   ═══════════════════════════════════════════════════════════════════════════════ */

function Inner({ slug }: { slug: string }) {
  const wallet = useWallet();
  const { connected, publicKey } = wallet;

  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

   /* ── State ────────────────────────────────────────────────────────────────── */
  const [loading,   setLoading]   = useState(!connected);
  const [initializing, setInitializing] = useState(false);
  const [err, setErr]               = useState<string>("");
  const [platform, setPlatform]     = useState<any>(null);
  const [projects, setProjects]     = useState<any[]>([]);
  const [slugProj, setSlugProj]     = useState<any>(null);
  const [slugBoxes, setSlugBoxes]   = useState<any[]>([]);
  const [allPrizes, setAllPrizes]   = useState<any[]>([]);
  const [slugLoaded, setSlugLoaded] = useState(false);

  /* ── Create Box Modal state ───────────────────────────────────────────────── */
  const [showCreateBox, setShowCreateBox] = useState(false);

  const [localBg, setLocalBg] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const localBranding = localStorage.getItem(`project_branding_${slug}`);
      if (localBranding) {
        try {
          const parsed = JSON.parse(localBranding);
          if (parsed.bgUri) setLocalBg(parsed.bgUri);
        } catch {}
      }
    }
  }, [slug]);

  const bgUri = resolveIpfsUrl(slugProj?.bgUri || localBg);

  const adminBgStyle = bgUri ? {
    backgroundImage: `radial-gradient(circle at top, rgba(10, 10, 10, 0.4) 0%, rgba(10, 10, 10, 0.85) 100%), url('${bgUri}')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundAttachment: 'fixed',
  } : {};

  /* ── Project Branding Modal state ─────────────────────────────────────────── */
  const [showBrandingModal, setShowBrandingModal] = useState(false);

  /* ── Vault Manager modal state ─────────────────────────────────────────────── */
  const [showVaultManager, setShowVaultManager] = useState(false);

  /* ── Listen for custom event from Navbar to open Create Box modal ── */
  useEffect(() => {
    const handleOpenCreateBox = () => setShowCreateBox(true);
    const handleOpenProjectBranding = () => setShowBrandingModal(true);
    const handleOpenVaultManager = () => setShowVaultManager(true);
    window.addEventListener('open-create-box', handleOpenCreateBox);
    window.addEventListener('open-project-branding', handleOpenProjectBranding);
    window.addEventListener('open-vault-manager', handleOpenVaultManager);
    return () => {
      window.removeEventListener('open-create-box', handleOpenCreateBox);
      window.removeEventListener('open-project-branding', handleOpenProjectBranding);
      window.removeEventListener('open-vault-manager', handleOpenVaultManager);
    };
  }, []);


  /* ── Project branding ───────────────────────────────────────────────────────── */
  const setProjectBranding = useSetProjectBranding();
  useEffect(() => {
    const name = slugProj?.name || slug;
    const logoUrl = resolveIpfsUrl(slugProj?.logoUri || null) || null;
    
    if (slugProj?.name) {
      setProjectBranding({
        name: slugProj.name,
        logoUrl: logoUrl,
        themeColor: slugProj.themeColor || null,
        nothingRewardImage: slugProj.nothingRewardImage || null,
      });
    } else {
      setProjectBranding({ name: slug, logoUrl: null, themeColor: null, nothingRewardImage: null });
    }

    // Set page title
    document.title = `Admin | ${name} | Mystery Box`;

    // Set favicon dynamically
    if (logoUrl) {
      let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement("link");
        link.rel = "shortcut icon";
        document.getElementsByTagName("head")[0].appendChild(link);
      }
      link.href = logoUrl;
    }
  }, [slugProj, setProjectBranding, slug]);

  /* ── On-chain assets state ─────────────────────────────────────────────────── */
  const [walletSol, setWalletSol] = useState<number | null>(null);
  const [vaultSol, setVaultSol] = useState<number | null>(null);
  const [walletAssets, setWalletAssets] = useState<any[]>([]);
  const [vaultAssets, setVaultAssets] = useState<any[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetsError, setAssetsError] = useState<string>("");

  const fetchOnChainAssets = useCallback(async () => {
    if (!connected || !publicKey) return;
    setLoadingAssets(true);
    setAssetsError("");
    try {
      const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
      const conn = new Connection(rpcUrl, "confirmed");
      
      // 1. Fetch Wallet SOL Balance
      const wSol = await retryWithBackoff(() => conn.getBalance(publicKey), "getBalance(wallet)");
      setWalletSol(wSol / 1e9);

      // 2. Fetch Vault SOL Balance
      const pgId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
      const [projPk] = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], pgId);
      const [vaultPk] = PublicKey.findProgramAddressSync([Buffer.from("vault"), projPk.toBuffer()], pgId);
      
      const vInfo = await retryWithBackoff(() => conn.getAccountInfo(vaultPk), "getAccountInfo(vault)");
      if (vInfo) {
        setVaultSol(vInfo.lamports / 1e9);
      } else {
        setVaultSol(0);
      }

      // 3. Fetch Admin Wallet Assets
      const wAssets = await fetchAssetsForOwner(publicKey, rpcUrl);
      setWalletAssets(wAssets);

      // 4. Fetch Vault Assets
      const vAssets = await fetchAssetsForOwner(vaultPk, rpcUrl);
      setVaultAssets(vAssets);
    } catch (e: any) {
      console.error("Error fetching assets:", e);
      setAssetsError(e.message || String(e));
    } finally {
      setLoadingAssets(false);
    }
  }, [connected, publicKey, slug]);

  /* ── Effect for active wallet connection ───────────────────────────────────── */
  useEffect(() => {
    if (connected && publicKey) {
      fetchOnChainAssets();
    }
  }, [connected, publicKey, fetchOnChainAssets]);

  /* ── Helpers ──────────────────────────────────────────────────────────────── */
  const fetchBoxes = useCallback(async () => {
    if (!connected || !publicKey) { setSlugLoaded(false); setSlugBoxes([]); return; }
    try {
      const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
      const pgId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
      const [pk] = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], pgId);

      const acc = await retryWithBackoff(() => conn.getAccountInfo(pk), "getAccountInfo(project)");
      if (acc) {
        try {
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          const decoded = decodeAccount<any>("Project", acc.data);
          if (typeof window !== "undefined" && decoded.slug) {
            const localBranding = localStorage.getItem(`project_branding_${decoded.slug}`);
            if (localBranding) {
              try {
                const parsed = JSON.parse(localBranding);
                decoded.name = parsed.name || decoded.name;
                decoded.description = parsed.description || decoded.description;
                decoded.logoUri = parsed.logoUri || decoded.logoUri;
                decoded.bgUri = parsed.bgUri || decoded.bgUri;
                decoded.themeColor = parsed.themeColor || decoded.themeColor;
                decoded.nothingRewardImage = parsed.nothingRewardImage || decoded.nothingRewardImage;
              } catch {}
            }
          }
          console.debug("[ProjectAdmin] decoded Project:", { slug: decoded.slug, name: decoded.name, isActive: decoded.isActive });
          setSlugProj(decoded);
        } catch { /* ignore */ }
      }

      const pgAccs = await retryWithBackoff(() => conn.getProgramAccounts(pgId), "getProgramAccounts(boxes)");
      const coder = BorshAccountsCoder;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const dec: any[] = [];
      const prizeDec: any[] = [];
      for (const { pubkey, account } of pgAccs) {
        try {
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          const b: any = (new coder(IDL as any)).decode("BoxConfig", account.data);
          if (b.project.equals(pk)) {
            const boxId = toUnixSeconds(b.boxId ?? b.box_id);
            let boxName = `Box #${boxId}`;
            let boxDesc = "";
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
            dec.push({
              ...b,
              pubkey: pubkey.toBase58(),
              startTime: toUnixSeconds(b.startTime ?? b.start_time),
              endTime: toUnixSeconds(b.endTime ?? b.end_time),
              status: boxStatusToCode(b.status),
              boxId,
              sold: toUnixSeconds(b.sold),
              supply: toUnixSeconds(b.supply),
              priceLamports: b.priceLamports?.toNumber?.() ?? b.priceLamports ?? b.price_lamports?.toNumber?.() ?? b.price_lamports ?? 0,
              bannerUri: boxBanner,
              name: boxName,
              description: boxDesc,
              acceptedMints: b.acceptedMints?.map?.((m: any) => m.toBase58()) ?? b.accepted_mints?.map?.((m: any) => m.toBase58()) ?? [],
              acceptedPrices: b.acceptedPrices?.map?.((p: any) => p.toNumber?.() ?? p) ?? b.accepted_prices?.map?.((p: any) => p.toNumber?.() ?? p) ?? [],
            });
          }
        } catch { /* not BoxConfig */ }

        try {
          const p: any = (new coder(IDL as any)).decode("PrizeItem", account.data);
          prizeDec.push(p);
        } catch { /* not PrizeItem */ }
      }
      setSlugBoxes(dec);
      setAllPrizes(prizeDec);
    } catch (e: unknown) {
      setErr((e as Error).message || String(e));
    } finally {
      setSlugLoaded(true);
    }
  }, [slug, connected, publicKey]);

  const refresh = useCallback(async () => {
    setErr("");
    const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");

    /* platform config */
    const [pPda] = await platformPDA();
    const acc = await retryWithBackoff(() => conn.getAccountInfo(pPda), "getAccountInfo(platform)");
    if (acc) {
      try { setPlatform(decodeAccount("PlatformConfig", acc.data)); }
      catch { setPlatform({ authority: acc.owner.toBase58(), treasury: "?", isPaused: false }); }
    } else {
      setPlatform(null);
    }

    /* all projects */
    setProjects(await fetchProjects());

    /* fetch on-chain assets */
    await fetchOnChainAssets();

    /* fetch specific project boxes */
    await fetchBoxes();
  }, [fetchOnChainAssets, fetchBoxes]);

  const copyPda = useCallback(async (pda: string) => {
    try { await navigator.clipboard.writeText(pda); toast.success("PDA copied!"); }
    catch { toast.error("Copy failed"); }
  }, []);

  const initializePlatform = useCallback(async () => {
    if (!wallet.publicKey) return;
    setErr(""); setInitializing(true);
    try {
      const [pPda] = await platformPDA();
      const ix = ixInitializePlatform(pPda, wallet.publicKey, TREASURY_WALLET);
      await sendIx(ix, wallet);
      await refresh();
    } catch (e: any) { setErr(getSolanaErrorDetails(e)); }
    finally { setInitializing(false); }
  }, [wallet, refresh]);

  const [migrating, setMigrating] = useState(false);

  const handleMigrateToV2 = useCallback(async () => {
    if (!connected || !publicKey || !slugProj) return;
    setMigrating(true);
    const toastId = toast.loading("Upgrading project account on-chain...", { id: "migration" });
    try {
      let nameVal = slugProj.name || slug;
      let descVal = slugProj.description || "";
      let logoVal = slugProj.logoUri || "";
      let bgVal = slugProj.bgUri || "";
      let themeVal = slugProj.themeColor || "#1cac64";

      if (typeof window !== "undefined") {
        const localBranding = localStorage.getItem(`project_branding_${slug}`);
        if (localBranding) {
          try {
            const parsed = JSON.parse(localBranding);
            nameVal = parsed.name || nameVal;
            descVal = parsed.description || descVal;
            logoVal = parsed.logoUri || logoVal;
            bgVal = parsed.bgUri || bgVal;
            themeVal = parsed.themeColor || themeVal;
          } catch {}
        }
      }

      await migrateProjectToV2Tx(wallet, {
        slug,
        bump: slugProj.bump,
        name: nameVal,
        description: descVal,
        logoUri: logoVal,
        bgUri: bgVal,
        themeColor: themeVal,
      });

      toast.success("Project account successfully upgraded to V2!", { id: "migration" });
      await refresh();
    } catch (e: any) {
      console.error(e);
      toast.error(getSolanaErrorDetails(e), { id: "migration" });
    } finally {
      setMigrating(false);
    }
  }, [connected, publicKey, slug, slugProj, wallet, refresh]);

  /* ── Load specific project + boxes when slug changes ───────────────────────  */
  useEffect(() => {
    fetchBoxes();
  }, [fetchBoxes]);

  /* ── Guards ──────────────────────────────────────────────────────────────── */
  if (!mounted) {
    return (
      <div 
        className={`flex flex-col items-center justify-center min-h-screen p-6 text-center ${bgUri ? "" : "gradient-bg"}`}
        style={adminBgStyle}
      >
        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mx-auto"></div>
        <p className="text-[#2d5a3f] text-sm mt-4 animate-pulse">Initializing wallet provider...</p>
      </div>
    );
  }

  if (!connected) {
    return (
      <div 
        className={`flex flex-col items-center justify-center min-h-screen p-6 text-center ${bgUri ? "" : "gradient-bg"}`}
        style={adminBgStyle}
      >
        <div className="max-w-md w-full bg-[#d9f5cc]/60 border border-[#1cac64]/20/80 rounded-3xl p-8 backdrop-blur-md space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent pointer-events-none" />
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-[#0f2618] tracking-tight">Project Admin Login</h2>
            <p className="text-[#2d5a3f] text-sm leading-relaxed">
              Please connect your project administrator wallet to manage this project's mystery boxes, vault, and branding.
            </p>
          </div>
          <div className="flex justify-center pt-2">
            <WalletMultiButton className="!bg-indigo-600 hover:!bg-indigo-700 !transition-all !rounded-xl !h-12 !px-6 !text-sm !font-semibold" />
          </div>
        </div>
      </div>
    );
  }

  if (!slugLoaded || !slugProj) {
    return (
      <div 
        className={`flex flex-col items-center justify-center min-h-screen p-6 text-center ${bgUri ? "" : "gradient-bg"}`}
        style={adminBgStyle}
      >
        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mx-auto"></div>
        <p className="text-[#2d5a3f] text-sm mt-4 animate-pulse">Loading project configuration from blockchain...</p>
      </div>
    );
  }

  // Access Control check
  const projectAuthority = slugProj.authority?.toBase58 ? slugProj.authority.toBase58() : String(slugProj.authority);
  const connectedKey = publicKey?.toBase58();
  const isAuthorized = connectedKey === projectAuthority;

  if (!isAuthorized) {
    return (
      <div 
        className={`flex flex-col items-center justify-center min-h-screen p-6 text-center ${bgUri ? "" : "gradient-bg"}`}
        style={adminBgStyle}
      >
        <div className="max-w-xl w-full bg-red-950/10 border border-red-900/30 rounded-3xl p-8 backdrop-blur-md space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-transparent pointer-events-none" />
          
          <div className="w-20 h-20 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto text-3xl shadow-lg shadow-red-500/5 animate-pulse">
            🚫
          </div>
          
          <div className="space-y-3">
            <h2 className="text-2xl font-black text-[#0f2618] tracking-tight">Access Denied</h2>
            <p className="text-[#1a3a2a] text-sm leading-relaxed max-w-md mx-auto">
              This admin dashboard is locked. Only the designated <span className="font-bold text-indigo-400">Project Admin Wallet</span> is permitted to view or edit settings.
            </p>
          </div>

          <div className="bg-black/60 border border-white/[0.05] p-5 rounded-2xl space-y-4 text-left font-mono text-xs shadow-inner">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[#3d6b4e]">
                <span className="uppercase tracking-wider font-bold text-[10px]">Authorized Project Admin:</span>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(projectAuthority);
                    toast.success("Copied admin address!");
                  }}
                  className="text-[9px] bg-[#1cac64]/8 hover:bg-white/10 px-2 py-0.5 rounded transition text-indigo-300 border border-white/5 font-sans cursor-pointer"
                >
                  Copy Address
                </button>
              </div>
              <div className="text-indigo-200 break-all select-all font-semibold p-2.5 bg-[#1cac64]/3 border border-[#1cac64]/8 rounded-lg">
                {projectAuthority}
              </div>
            </div>
            
            <div className="space-y-1.5 border-t border-[#1cac64]/10 pt-3">
              <div className="flex justify-between items-center text-[#3d6b4e]">
                <span className="uppercase tracking-wider font-bold text-[10px]">Your Connected Wallet:</span>
              </div>
              <div className="text-red-400 break-all font-semibold p-2.5 bg-red-500/[0.02] border border-red-500/[0.05] rounded-lg">
                {connectedKey}
              </div>
            </div>
          </div>

          <p className="text-xs text-[#2d5a3f] max-w-sm mx-auto leading-normal">
            To gain access, switch to the authorized project admin wallet in your Solana wallet extension or disconnect the current one.
          </p>

          <div className="flex justify-center pt-2">
            <WalletMultiButton className="!bg-indigo-600 hover:!bg-indigo-700 !transition-all !rounded-xl !h-12 !px-6 !text-sm !font-semibold" />
          </div>
        </div>
      </div>
    );
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */
  /* Derive project PDA once here so both header and modals share it */
  const pgId  = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
  const projPda = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], pgId)[0].toBase58();

  return (
    <div className={`w-full min-h-screen p-6 flex flex-col ${bgUri ? "" : "gradient-bg"}`} style={adminBgStyle}>
      <div className="space-y-6 max-w-6xl mx-auto flex-grow w-full pb-12">
        {err && <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">{err}</div>}

        {slugProj && !slugProj.isV2 && (
          <div className="p-5 rounded-3xl bg-amber-950/40 border border-amber-500/30 text-amber-200 flex flex-col md:flex-row items-center justify-between gap-4 backdrop-blur-sm shadow-xl">
            <div className="space-y-1 text-center md:text-left">
              <h3 className="font-bold text-sm text-[#0f2618] uppercase tracking-wider flex items-center justify-center md:justify-start gap-2">
                ⚠️ Account Upgrade Required (V2 Migration)
              </h3>
              <p className="text-xs text-amber-300/80 leading-relaxed">
                This project was created on an older version of the program. Upgrade your project account on-chain to enable persistent, decentralized branding fields (Name, Logo, Banner, and Theme) directly on the blockchain.
              </p>
            </div>
            <button
              onClick={handleMigrateToV2}
              disabled={migrating}
              className="px-6 py-3 rounded-xl bg-amber-500 text-black font-bold text-xs uppercase tracking-wider hover:bg-amber-400 active:scale-95 disabled:opacity-50 transition cursor-pointer whitespace-nowrap shrink-0 shadow-lg shadow-amber-500/10"
            >
              {migrating ? "Upgrading..." : "Upgrade to V2"}
            </button>
          </div>
        )}

      <div className="flex flex-col items-center justify-center gap-4 bg-[#1cac64]/3 border border-white/[0.05] p-8 rounded-3xl backdrop-blur-sm text-center">
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center justify-center gap-3 w-full">
            <h1 className="text-2xl md:text-3xl font-black text-[#0f2618]">{slugProj.name || slug}</h1>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 w-full">
          <span className="text-[10px] md:text-xs bg-[#ebfde3]/60 border border-white/[0.05] px-3 py-1.5 rounded-lg font-mono text-indigo-300 flex items-center justify-center gap-2 max-w-full">
            <span className="text-[#3d6b4e] uppercase tracking-widest font-bold">PDA:</span>
            <span className="truncate">{projPda}</span>
            <button onClick={() => copyPda(projPda)} className="text-[#2d5a3f] hover:text-[#0f2618] transition-colors shrink-0" title="Copy PDA">📋</button>
          </span>
          <span className="text-[10px] md:text-xs bg-[#ebfde3]/60 border border-white/[0.05] px-3 py-1.5 rounded-lg font-mono text-indigo-300 flex items-center justify-center gap-2 max-w-full">
            <span className="text-[#3d6b4e] uppercase tracking-widest font-bold">ATA Rent Recipient:</span>
            <span className="font-bold text-amber-400">{slugProj.rentClaimMode === 1 ? "Platform Treasury" : "Project Authority"}</span>
          </span>
        </div>
        
      </div>

      {showBrandingModal && slugProj && (
        <ProjectBrandingModal
          slug={slug}
          slugProj={slugProj}
          onClose={() => setShowBrandingModal(false)}
          onRefresh={refresh}
        />
      )}
      {showCreateBox && (
        <CreateBoxModal slug={slug} onClose={() => setShowCreateBox(false)} onDone={refresh} walletAssets={walletAssets} vaultAssets={vaultAssets} vaultSol={vaultSol} allPrizes={allPrizes} />
      )}
      {showVaultManager && (
        <VaultManager
          slug={slug}
          onClose={() => setShowVaultManager(false)}
          onDone={() => { setShowVaultManager(false); refresh(); }}
          walletSol={walletSol}
          vaultSol={vaultSol}
          walletAssets={walletAssets}
          vaultAssets={vaultAssets}
          loadingAssets={loadingAssets}
          assetsError={assetsError}
          onRefreshAssets={fetchOnChainAssets}
          rentClaimMode={slugProj?.rentClaimMode}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Total boxes" value={slugBoxes.length} />
        <Stat label="Active" value={slugBoxes.filter((b:any) => boxStatusToCode(b.status)===0).length} color="text-green-400" />
        <Stat label="Paused" value={slugBoxes.filter((b:any) => boxStatusToCode(b.status)===1).length} color="text-yellow-400" />
        <Stat label="Ended"  value={slugBoxes.filter((b:any) => boxStatusToCode(b.status)===2).length} color="text-red-400" />
        <StatRevenue label="Total Revenue" boxes={slugBoxes} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input placeholder="Search boxes…"
          value={""}
          onChange={() => {}}
          className="flex-1 min-w-[200px] bg-[#d9f5cc] border border-gray-700 rounded-lg px-3 py-2 text-sm text-[#0f2618] placeholder-gray-500" />
        <button onClick={refresh} className="px-3 py-2 text-sm text-[#2d5a3f] hover:text-[#0f2618] transition">↻ Refresh</button>
      </div>
      {slugBoxes.length === 0 ? (
        <div className="bg-[#c8edba]/40 border border-gray-700 rounded-xl p-8 text-center text-[#3d6b4e]">
          No boxes yet. Create your first one above.
        </div>
      ) : (
        <ProjectBoxGrid boxes={slugBoxes} slug={slug} onRefresh={refresh} walletAssets={walletAssets} vaultAssets={vaultAssets} rentClaimMode={slugProj?.rentClaimMode} />
      )}
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-[#1cac64]/10 mt-auto pt-8 pb-4">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4">
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

/* ─── Project-level box grid with inline Edit / Close ─────────────────────── */

function ProjectBoxGrid({
  boxes,
  slug,
  onRefresh,
  walletAssets,
  vaultAssets,
  rentClaimMode
}: {
  boxes: any[];
  slug: string;
  onRefresh: () => void;
  walletAssets: any[];
  vaultAssets: any[];
  rentClaimMode?: number;
}) {
  const [editBox, setEditBox]   = useState<any>(null);
  const [closingBox, setClosingBox] = useState<any>(null);
  const [prizeBox, setPrizeBox] = useState<any>(null);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {boxes.map((b: any) => {
          const id       = b.boxId?.toNumber?.() ?? b.boxId ?? 0;
          const sold     = b.sold?.toNumber?.()     ?? b.sold      ?? 0;
          const supply   = b.supply?.toNumber?.()   ?? b.supply    ?? 1;
          const pct      = supply > 0 ? Math.round((sold / supply) * 100) : 0;
          const statusCode = boxStatusToCode(b.status);
          const active   = statusCode === 0;
          const canEdit  = active && sold === 0;
          const canClose = statusCode === 2 && sold >= supply;
          const started  = toUnixSeconds(b.startTime ?? b.start_time);
          const endTs    = toUnixSeconds(b.endTime ?? b.end_time);
          const now      = Math.floor(Date.now() / 1000);
          const inRange  = active && now >= started && now <= endTs;
          const pastWindow = now > endTs;
          const notStarted = now < started;

          const badgeLabel = statusCode === 1 
            ? "Paused" 
            : statusCode === 2 
              ? "Ended" 
              : notStarted 
                ? "Upcoming" 
                : pastWindow 
                  ? "Ended" 
                  : "Active";

          const badgeClass = statusCode === 1
            ? "bg-yellow-500/15 text-yellow-400"
            : statusCode === 2 || pastWindow
              ? "bg-red-500/15 text-red-400"
              : notStarted
                ? "bg-purple-500/15 text-purple-400"
                : "bg-green-500/15 text-green-400";

          return (
            <div key={b.pubkey} className="bg-[#c8edba]/60 border border-gray-700 rounded-xl overflow-hidden hover:border-gray-500 transition">
              {b.bannerUri && <img src={b.bannerUri} alt="" className="h-36 w-full object-cover" />}
              <div className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{b.name || `Box #${id}`}</p>
                    <p className="text-xs text-[#3d6b4e] font-mono truncate">{b.pubkey}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${badgeClass}`}>{badgeLabel}</span>
                </div>
                {b.description && <p className="text-xs text-[#2d5a3f] line-clamp-2">{b.description}</p>}
                <div>
                  <div className="flex justify-between text-xs text-[#3d6b4e] mb-1"><span>{sold}/{supply} sold</span><span>{pct}%</span></div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#3d6b4e]">
                  <span className={inRange ? "text-green-400" : "text-[#3d6b4e]"}>
                    {statusCode === 1 
                      ? "⏸ Paused" 
                      : statusCode === 2 
                        ? "❌ Ended" 
                        : notStarted 
                          ? "🔒 Not started" 
                          : pastWindow 
                            ? "❌ Ended" 
                            : "▶ Live"}
                  </span>
                  <span>Start: {new Date(started*1000).toLocaleDateString()}</span>
                  <span>End: {new Date(endTs*1000).toLocaleDateString()}</span>
                </div>
                <div className="flex gap-3 text-xs">
                  <span><span className="text-[#3d6b4e]">Price </span><span className="text-green-400 font-mono font-semibold">{((b.priceLamports?.toNumber?.() ?? b.priceLamports ?? 0)/1e9).toFixed(4)} SOL</span></span>
                  <span className="text-[#3d6b4e]">• {supply===1?"1 NFT":`${supply} total`}</span>
                </div>
                <div className="flex gap-2 pt-2 border-t border-gray-700/50">
                  <button
                    onClick={() => setEditBox(b)} disabled={!canEdit}
                    title={canEdit ? "Edit box" : "Edit when Active + 0 sold"}
                    className="flex-1 text-xs px-2 py-1.5 rounded border border-gray-600 hover:bg-gray-700 transition disabled:opacity-30">Edit</button>
                  <button
                    onClick={() => setPrizeBox(b)}
                    className="flex-1 text-xs px-2 py-1.5 rounded border border-amber-600/40 hover:bg-amber-900/20 text-amber-400 font-bold transition">Prize</button>
                  <button
                    onClick={() => setClosingBox(b)} disabled={!canClose}
                    title={canClose ? "Close and refund rent" : "Can close when Ended + fully sold"}
                    className="flex-1 text-xs px-2 py-1.5 rounded border border-red-900/40 hover:bg-red-950/40 text-red-400 disabled:opacity-30 transition">Close</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editBox && (
        <EditModal box={editBox} slug={slug} onClose={() => setEditBox(null)} onDone={() => { setEditBox(null); onRefresh(); }} walletAssets={walletAssets} vaultAssets={vaultAssets} />
      )}
      {closingBox && (
        <CloseModal box={closingBox} slug={slug} onClose={() => setClosingBox(null)} onDone={() => { setClosingBox(null); onRefresh(); }} />
      )}
      {prizeBox && (
        <PrizeItemManager box={prizeBox} slug={slug} onClose={() => setPrizeBox(null)} onDone={() => { setPrizeBox(null); onRefresh(); }} walletAssets={walletAssets} vaultAssets={vaultAssets} />
      )}
    </>
  );
}

/* ─── Edit Box modal ──────────────────────────────────────────────────────── */

function EditModal({
  box,
  slug,
  onClose,
  onDone,
  walletAssets,
  vaultAssets
}: {
  box: any;
  slug: string;
  onClose: () => void;
  onDone: () => void;
  walletAssets: any[];
  vaultAssets: any[];
}) {
  const wallet = useWallet();
  const id = box.boxId?.toNumber?.() ?? box.boxId ?? 0;
  const [name, setName]        = useState(box.name ?? "");
  const [desc, setDesc]        = useState(box.description ?? "");
  const [banner, setBanner]    = useState(box.bannerUri ?? "");
  const [startStr, setStartStr]= useState(unixToDatetimeLocal(toUnixSeconds(box.startTime ?? box.start_time)));
  const [endStr, setEndStr]    = useState(unixToDatetimeLocal(toUnixSeconds(box.endTime ?? box.end_time)));
  const [prices, setPrices]    = useState<string[]>(() => {
    return [0, 1, 2].map(i => String((box.acceptedPrices?.[i] ?? 0) / 1e9));
  });

  const initialSelected = useMemo(() => {
    return [0, 1, 2].map(i => {
      const mintPk = box.acceptedMints?.[i];
      if (!mintPk) return "";
      const mintStr = typeof mintPk === "string" ? mintPk : (mintPk.toBase58?.() ?? "");
      if (!mintStr || mintStr === PublicKey.default.toBase58() || mintStr === "11111111111111111111111111111111") return "";
      if (mintStr === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") return mintStr;
      const inWallet = walletAssets.some(t => t.mint === mintStr);
      const inVault = vaultAssets.some(t => t.mint === mintStr);
      if (inWallet || inVault) return mintStr;
      return "CUSTOM";
    });
  }, [box.acceptedMints, walletAssets, vaultAssets]);

  const initialCustom = useMemo(() => {
    return [0, 1, 2].map(i => {
      const mintPk = box.acceptedMints?.[i];
      if (!mintPk) return "";
      const mintStr = typeof mintPk === "string" ? mintPk : (mintPk.toBase58?.() ?? "");
      if (!mintStr || mintStr === PublicKey.default.toBase58() || mintStr === "11111111111111111111111111111111") return "";
      if (mintStr === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") return "";
      const inWallet = walletAssets.some(t => t.mint === mintStr);
      const inVault = vaultAssets.some(t => t.mint === mintStr);
      if (inWallet || inVault) return "";
      return mintStr;
    });
  }, [box.acceptedMints, walletAssets, vaultAssets]);

  const [selectedMints, setSelectedMints] = useState<string[]>(initialSelected);
  const [customMints, setCustomMints] = useState<string[]>(initialCustom);
  const [loading, setLoading]  = useState(false);
  const [err, setErr]          = useState("");

  const tokenOptions = useMemo(() => {
    const isMainnet = NETWORK.toLowerCase().includes("mainnet");
    const opts = [
      { value: "SOL", label: "Solana (SOL)" },
      { value: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", label: `USDC (${isMainnet ? "Mainnet" : "Devnet"})` },
    ];
    const seen = new Set(opts.map(o => o.value));
    walletAssets.filter(t => !t.isNFT).forEach(t => {
      if (!seen.has(t.mint)) {
        seen.add(t.mint);
        opts.push({ value: t.mint, label: `${t.name} (${t.uiAmount} in wallet)` });
      }
    });
    vaultAssets.filter(t => !t.isNFT).forEach(t => {
      if (!seen.has(t.mint)) {
        seen.add(t.mint);
        opts.push({ value: t.mint, label: `${t.name} (${t.uiAmount} in vault)` });
      }
    });
    opts.push({ value: "CUSTOM", label: "Custom Mint..." });
    opts.push({ value: "", label: "-- None --" });
    return opts;
  }, [walletAssets, vaultAssets]);

  const submit = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true); setErr("");
    try {
      const { updateBoxTx } = await import("@/lib/actions");
      const mintsPk: PublicKey[] = [];
      for (let i = 0; i < selectedMints.length; i++) {
        const sm = selectedMints[i];
        if (sm === "SOL") {
          mintsPk.push(PublicKey.default);
        } else if (sm === "CUSTOM") {
          const trimmed = customMints[i].trim();
          if (!trimmed) {
            mintsPk.push(PublicKey.default);
          } else {
            try {
              mintsPk.push(new PublicKey(trimmed));
            } catch {
              toast.error(`Invalid custom mint public key for slot ${i + 1}`);
              setLoading(false);
              return;
            }
          }
        } else {
          const trimmed = sm.trim();
          if (!trimmed) {
            mintsPk.push(PublicKey.default);
          } else {
            try {
              mintsPk.push(new PublicKey(trimmed));
            } catch {
              toast.error(`Invalid public key for payment token slot ${i + 1}`);
              setLoading(false);
              return;
            }
          }
        }
      }
      const pricesN = prices.map(p => Math.round((Number(p) || 0) * 1e9));
      
      // Automatically derive priceLamports from SOL entry in accepted tokens
      const solIndex = selectedMints.indexOf("SOL");
      const solPriceStr = solIndex !== -1 ? prices[solIndex] : "0";
      const priceLamports = Math.round(parseFloat(solPriceStr || "0") * 1e9);

      const inputStart = datetimeLocalToUnix(startStr);
      const nowSec = Math.floor(Date.now() / 1000);
      const startTime = inputStart <= nowSec + 900 ? inputStart - 600 : inputStart;

      await updateBoxTx(wallet, {
        slug, boxId: id,
        priceLamports,
        acceptedMints: mintsPk, acceptedPrices: pricesN,
        startTime,
        endTime:   datetimeLocalToUnix(endStr),
      });

      if (typeof window !== "undefined") {
        localStorage.setItem(
          `box_branding_${slug}_${id}`,
          JSON.stringify({
            name: name.trim(),
            description: desc.trim(),
            bannerUri: banner.trim(),
          })
        );
      }
      
      // Delay to let validator index account state completely
      await new Promise(resolve => setTimeout(resolve, 1500));
      onDone();
    } catch (e: any) { setErr(getSolanaErrorDetails(e)); }
    finally { setLoading(false); }
  }, [wallet, slug, id, name, desc, banner, startStr, endStr, selectedMints, customMints, prices, onDone]);

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-lg rounded-3xl p-6 space-y-5 max-h-[85vh] overflow-auto shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-[#2d5a3f] hover:text-[#0f2618] transition-colors p-2 bg-[#1cac64]/8 rounded-full hover:bg-white/10"
        >
          ✕
        </button>

        <h2 className="text-xl font-black text-[#0f2618] uppercase tracking-wider">
          Edit Box #{id}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Name *" val={name} onChange={setName} mdFull />
          <Field label="Description" val={desc} onChange={setDesc} rows={2} mdFull />
          <ImageUpload label="Banner Image" value={banner} onChange={setBanner} className="md:col-span-2" />
          <Field label="Start" val={startStr} onChange={setStartStr} type="datetime-local" />
          <Field label="End"   val={endStr}   onChange={setEndStr}   type="datetime-local" />
        </div>
        
        <div className="space-y-2">
          <p className="text-xs font-bold text-[#2d5a3f] uppercase tracking-wider">Accepted tokens (up to 3):</p>
          {[0, 1, 2].map(i => (
            <div key={i} className="flex flex-col gap-1.5 p-3 bg-[#ffffff]/40 border border-[#1cac64]/15 rounded-xl">
              <div className="flex gap-2">
                <select
                  value={selectedMints[i]}
                  onChange={e => {
                    const c = [...selectedMints];
                    c[i] = e.target.value;
                    setSelectedMints(c);
                  }}
                  className="flex-1 bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2.5 py-1.5 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
                >
                  {tokenOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input
                  placeholder="price"
                  type="number"
                  value={prices[i]}
                  onChange={e => {
                    const c = [...prices];
                    c[i] = e.target.value;
                    setPrices(c);
                  }}
                  className="w-28 bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2.5 py-1.5 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
                />
              </div>
              {selectedMints[i] === "CUSTOM" && (
                <input
                  placeholder="Enter custom mint address..."
                  value={customMints[i]}
                  onChange={e => {
                    const c = [...customMints];
                    c[i] = e.target.value;
                    setCustomMints(c);
                  }}
                  className="bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2.5 py-1.5 text-xs font-mono text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
                />
              )}
            </div>
          ))}
        </div>

        {err && <p className="text-red-600 text-xs p-3 bg-red-500/10 border border-red-500/20 rounded-xl">{err}</p>}
        
        <div className="flex gap-3 pt-3 border-t border-[#1cac64]/15">
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl font-bold uppercase tracking-wider text-xs bg-[#1cac64]/8 text-[#1a3a2a] hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !name.trim()}
            className="flex-1 py-3 px-4 rounded-xl font-bold uppercase tracking-wider text-xs bg-gradient-to-r from-emerald-500 to-teal-500 text-[#0f2618] hover:from-emerald-400 hover:to-teal-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50"
          >
            {loading ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Close Box dialog ────────────────────────────────────────────────────── */

function CloseModal({ box, slug, onClose, onDone }: { box: any; slug: string; onClose: () => void; onDone: () => void }) {
  const wallet = useWallet();
  const id = box.boxId?.toNumber?.() ?? box.boxId ?? 0;
  const [err, setErr] = useState("");
  const [loading,setLoading] = useState(false);

  const confirm = useCallback(async () => {
    if (!wallet.publicKey) return;
    setLoading(true); setErr("");
    try {
      const { closeBoxTx } = await import("@/lib/actions");
      await closeBoxTx(wallet, { slug, boxId: id });
      onDone();
    } catch (e: any) { setErr(getSolanaErrorDetails(e)); }
    finally { setLoading(false); }
  }, [wallet, slug, id, onDone]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-[#d9f5cc] rounded-2xl p-6 w-full max-w-sm space-y-4 border border-red-900/40 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <h3 className="font-bold text-lg text-red-400">Close Box #{id}</h3>
        <p className="text-xs text-[#2d5a3f] leading-relaxed">
          This action is <strong className="text-red-300">irreversible</strong>. The box configuration PDA will be deleted on-chain, and its rent will be refunded to your admin wallet.
        </p>
        {err && <p className="text-red-400 text-xs p-3 bg-red-950/40 border border-red-700/50 rounded-lg">{err}</p>}
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2 border border-[#1cac64]/20 rounded-lg text-xs font-semibold hover:bg-[#c8edba] text-[#2d5a3f] hover:text-[#0f2618] transition">Cancel</button>
          <button onClick={confirm} disabled={loading} className="flex-1 py-2 bg-red-600 text-[#0f2618] text-xs font-bold hover:bg-red-500 disabled:opacity-40 rounded-lg transition">{loading?"Closing…":"Confirm Close"}</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Field helper ────────────────────────────────────────────────────────── */

function Field({ label, val, onChange, placeholder = "", type = "text", rows, mdFull = false }: {
  label: string; val: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; rows?: number; mdFull?: boolean;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className={mdFull ? "md:col-span-2" : ""}>
      <label htmlFor={id} className="block text-xs text-[#2d5a3f] mb-1 font-bold">{label}</label>
      {rows ? (
        <textarea id={id} value={val} onChange={e => onChange(e.target.value)} rows={rows}
          className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-3 py-2 text-xs text-[#0f2618] placeholder-[#6b9b7a] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all resize-none" />
      ) : (
        <input id={id} type={type} value={val} onChange={e => onChange(e.target.value)}
          className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-3 py-2 text-xs text-[#0f2618] placeholder-[#6b9b7a] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
          placeholder={placeholder} />
      )}
    </div>
  );
}

/* ─── Stat card ───────────────────────────────────────────────────────────── */

function Stat({ label, value, color = "text-[#0f2618]" }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-[#d9f5cc]/60 border border-[#1cac64]/20/80 rounded-xl p-4 flex flex-col justify-between shadow-lg">
      <p className="text-[10px] text-[#3d6b4e] uppercase tracking-wider font-bold">{label}</p>
      <p className={`text-2xl font-black mt-1 font-mono ${color}`}>{value}</p>
    </div>
  );
}

function StatRevenue({ label, boxes }: { label: string; boxes: any[] }) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const revenueByToken = useMemo(() => {
    const map = new Map<string, { amount: number; decimals: number; symbol: string }>();

    boxes.forEach((box) => {
      const sold = box.sold?.toNumber?.() ?? box.sold ?? 0;
      if (sold <= 0) return;

      const acceptedMints = box.acceptedMints?.map((m: any) => (typeof m === "string" ? m : m.toBase58?.() ?? m)) ?? [];
      const acceptedPrices = box.acceptedPrices?.map((p: any) => (typeof p === "number" ? p : p.toNumber?.() ?? 0)) ?? [];

      acceptedMints.forEach((mint: string, idx: number) => {
        if (!mint || mint === PublicKey.default.toBase58() || mint === "11111111111111111111111111111111") {
          if (idx > 0) return; // Ignore unused default placeholders
          const priceLamports = box.priceLamports?.toNumber?.() ?? box.priceLamports ?? box.price_lamports?.toNumber?.() ?? box.price_lamports ?? 0;
          const amount = sold * (priceLamports / 1e9);
          const existing = map.get("SOL");
          if (existing) {
            existing.amount += amount;
          } else {
            map.set("SOL", { amount, decimals: 9, symbol: "SOL" });
          }
        } else {
          const price = acceptedPrices[idx] ?? 0;
          const existing = map.get(mint);
          if (existing) {
            existing.amount += sold * price;
          } else {
            map.set(mint, { amount: sold * price, decimals: 9, symbol: mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? "USDC" : `Token ${mint.slice(0,4)}` });
          }
        }
      });
    });

    return Array.from(map.entries());
  }, [boxes]);

  const totalRevenueSol = revenueByToken.reduce((sum, [_, data]) => {
    if (_ === "SOL") return sum + data.amount;
    return sum;
  }, 0);

  return (
    <div className="relative">
      <div
        className="bg-[#1cac64]/5 border border-[#1cac64]/30 rounded-xl p-4 flex flex-col justify-between shadow-lg cursor-pointer hover:bg-[#1cac64]/10 transition"
        onClick={() => setShowBreakdown(!showBreakdown)}
      >
        <p className="text-[10px] text-[#1cac64]/70 uppercase tracking-wider font-bold">{label}</p>
        <p className="text-2xl font-black mt-1 font-mono text-[#1cac64]">
          {totalRevenueSol.toFixed(4)} SOL
        </p>
        {revenueByToken.length > 1 && (
          <p className="text-[10px] text-[#1cac64]/50 mt-1">
            +{revenueByToken.length - 1} token{revenueByToken.length - 1 > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {showBreakdown && (
        <div className="absolute z-50 top-full left-0 mt-2 w-64 bg-[#d9f5cc] border border-[#1cac64]/20 rounded-xl p-3 shadow-2xl">
          <p className="text-[10px] text-[#3d6b4e] uppercase tracking-wider font-bold mb-2">Revenue Breakdown</p>
          <div className="space-y-1.5">
            {revenueByToken.map(([mint, data]) => (
              <div key={mint} className="flex justify-between items-center text-xs">
                <span className="text-[#1a3a2a] font-mono">{data.symbol}</span>
                <span className="text-[#1cac64] font-mono">
                  {data.amount.toFixed(4)}
                  {mint !== "SOL" ? "" : " SOL"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CREATE BOX MODAL
   - Dynamic accepted payment tokens (1–5 slots, add / remove).
   - Vault-based reward / prize configuration with AssetAvatar rendering.
   - Cumulative win-rate calculator.
   - Sequential on-chain creation: box config → prize items.
═══════════════════════════════════════════════════════════════════════════════ */

interface PaymentOption { id: number; mintKey: string; customMint: string; price: string; }
interface RewardEntry  { id: number; assetKey: string; amountPerWin: string; totalCount: string; winPct: string; }

function CreateBoxModal({
  slug, onClose, onDone, walletAssets, vaultAssets, vaultSol, allPrizes
}: {
  slug: string;
  onClose: () => void;
  onDone: () => void;
  walletAssets: any[];
  vaultAssets: any[];
  vaultSol: number | null;
  allPrizes: any[];
}) {
  const wallet = useWallet();
  const [name, setName]       = useState("");
  const [desc, setDesc]       = useState("");
  const [banner, setBanner]   = useState("");
  const [supply, setSupply]   = useState("100");
  const [startStr, setStart]  = useState(() => unixToDatetimeLocal(Math.floor(Date.now() / 1000)));
  const [endStr, setEnd]      = useState(() => unixToDatetimeLocal(Math.floor(Date.now() / 1000) + 86400 * 7));
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");
  const [step, setStep]       = useState("");

  /* ── Dynamic accepted payment tokens (1–5) ──────────────────────────────── */
  const [payOpts, setPayOpts] = useState<PaymentOption[]>([
    { id: 0, mintKey: "SOL", customMint: "", price: "0" },
  ]);
  const nextPayId = useMemo(() => (payOpts.length > 0 ? Math.max(...payOpts.map(p => p.id)) + 1 : 0), [payOpts]);

  const tokenOptions = useMemo(() => {
    const isMainnet = NETWORK.toLowerCase().includes("mainnet");
    const opts = [
      { value: "SOL", label: "◎ Solana (SOL)" },
      { value: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", label: `💲 USDC (${isMainnet ? "Mainnet" : "Devnet"})` },
    ];
    const seen = new Set(opts.map(o => o.value));
    walletAssets.filter((t: any) => !t.isNFT).forEach((t: any) => {
      if (!seen.has(t.mint)) { seen.add(t.mint); opts.push({ value: t.mint, label: `${t.name} (${t.uiAmount} wallet)` }); }
    });
    vaultAssets.filter((t: any) => !t.isNFT).forEach((t: any) => {
      if (!seen.has(t.mint)) { seen.add(t.mint); opts.push({ value: t.mint, label: `${t.name} (${t.uiAmount} vault)` }); }
    });
    opts.push({ value: "CUSTOM", label: "🔑 Custom Mint…" });
    opts.push({ value: "", label: "— None —" });
    return opts;
  }, [walletAssets, vaultAssets]);

  const updatePay = (id: number, field: keyof PaymentOption, val: string) =>
    setPayOpts(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p));

  /* ── Dynamic vault rewards ──────────────────────────────────────────────── */
  const [rewards, setRewards] = useState<RewardEntry[]>([]);
  const nextRewardId = useMemo(() => (rewards.length > 0 ? Math.max(...rewards.map(r => r.id)) + 1 : 0), [rewards]);

  const rewardAssetOptions = useMemo(() => {
    const opts: { value: string; label: string; asset: any | null }[] = [];
    if (vaultSol !== null && vaultSol > 0) {
      opts.push({
        value: "__SOL__",
        label: `◎ SOL (${vaultSol.toFixed(4)} in vault)`,
        asset: { mint: PublicKey.default.toBase58(), name: "SOL", decimals: 9, uiAmount: vaultSol, isNFT: false, image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" },
      });
    }

    // Determine allocated NFT mints across active prizes (where claims remaining > 0)
    const allocatedNftMints = new Set<string>();
    (allPrizes || []).forEach((p: any) => {
      let isNft = false;
      const pType = p.prizeType ?? p.prize_type;
      if (typeof pType === "number") {
        isNft = pType === 2;
      } else if (pType && typeof pType === "object") {
        isNft = "nft" in pType || "Nft" in pType;
      }
      if (isNft) {
        const total = p.totalCount ?? p.total_count ?? 0;
        const claimed = p.claimedCount ?? p.claimed_count ?? 0;
        if (total > claimed) {
          const mintStr = p.tokenMint?.toBase58?.() ?? p.token_mint?.toBase58?.() ?? String(p.tokenMint ?? p.token_mint ?? "");
          if (mintStr && mintStr !== PublicKey.default.toBase58()) {
            allocatedNftMints.add(mintStr);
          }
        }
      }
    });

    vaultAssets.forEach((t: any) => {
      // Filter out allocated NFTs to prevent double allocation/Conflict
      if (t.isNFT && allocatedNftMints.has(t.mint)) {
        return;
      }
      opts.push({
        value: t.mint,
        label: `${t.isNFT ? "🎨" : "🪙"} ${t.name} (${t.uiAmount} in vault)`,
        asset: t,
      });
    });
    opts.push({
      value: "__NOTHING__",
      label: `🎁 Nothing (Empty slot / No reward)`,
      asset: { mint: PublicKey.default.toBase58(), name: "Nothing", decimals: 9, uiAmount: 999999, isNFT: false, image: "🎁" },
    });
    return opts;
  }, [vaultSol, vaultAssets, allPrizes]);

  const updateReward = (id: number, field: keyof RewardEntry, val: string) =>
    setRewards(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));

  const cumulativeWinPct = useMemo(() => rewards.reduce((s, r) => s + (parseFloat(r.winPct) || 0), 0), [rewards]);

  const resolveRewardAsset = (key: string) => rewardAssetOptions.find(o => o.value === key)?.asset ?? null;

  /* ── Submit handler ─────────────────────────────────────────────────────── */
  const submit = useCallback(async () => {
    if (!wallet.publicKey) return;
    if (!name.trim()) { toast.error("Name required"); return; }
    if (cumulativeWinPct > 100) { toast.error("Total win % exceeds 100%"); return; }
    setLoading(true); setErr(""); setStep("");
    try {
      /* ---- derive next box ID ---- */
      setStep("Resolving box ID…");
      const conn    = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
      const pgId    = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
      const [projPk] = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], pgId);
      const allBoxes = await retryWithBackoff(() => conn.getProgramAccounts(pgId), "getProgramAccounts");
      const projectBoxes: number[] = [];
      for (const { account } of allBoxes) {
        try {
          const b = decodeAccount<any>("BoxConfig", account.data);
          if ((b.project as PublicKey).equals(projPk)) projectBoxes.push(b.boxId?.toNumber?.() ?? b.boxId ?? 0);
        } catch { /* not BoxConfig */ }
      }
      const nextId = projectBoxes.length > 0 ? Math.max(...projectBoxes) + 1 : 0;

      /* ---- build accepted-mints arrays (always length 5) ---- */
      const mintsPk: PublicKey[] = [];
      const priceArr: number[] = [];
      for (const po of payOpts) {
        if (po.mintKey === "SOL") {
          mintsPk.push(PublicKey.default);
        } else if (po.mintKey === "CUSTOM") {
          const trimmed = po.customMint.trim();
          if (!trimmed) {
            mintsPk.push(PublicKey.default);
          } else {
            try {
              mintsPk.push(new PublicKey(trimmed));
            } catch {
              toast.error(`Invalid custom mint public key`);
              setLoading(false);
              setStep("");
              return;
            }
          }
        } else if (po.mintKey) {
          const trimmed = po.mintKey.trim();
          if (!trimmed) {
            mintsPk.push(PublicKey.default);
          } else {
            try {
              mintsPk.push(new PublicKey(trimmed));
            } catch {
              toast.error(`Invalid public key for payment token`);
              setLoading(false);
              setStep("");
              return;
            }
          }
        } else {
          mintsPk.push(PublicKey.default);
        }
        priceArr.push(Math.round((Number(po.price) || 0) * 1e9));
      }
      while (mintsPk.length < 3) { mintsPk.push(PublicKey.default); priceArr.push(0); }

      // Automatically derive priceLamports from SOL entry in dynamic payment options
      const solOpt = payOpts.find(po => po.mintKey === "SOL");
      const priceLamports = solOpt ? Math.round(parseFloat(solOpt.price || "0") * 1e9) : 0;

      const inputStart = datetimeLocalToUnix(startStr);
      const nowSec = Math.floor(Date.now() / 1000);
      const startTime = inputStart <= nowSec + 900 ? inputStart - 600 : inputStart;

      // Build prizes list
      const prizesParams: {
        prizeIndex: number;
        prizeType: "Sol" | "SplToken" | "Nft";
        tokenMint: PublicKey;
        amount: number;
        winPercentage: number;
        totalCount: number;
      }[] = [];

      for (let i = 0; i < rewards.length; i++) {
        const rw = rewards[i];
        const asset = resolveRewardAsset(rw.assetKey);
        if (!asset) continue;

        const isSol = rw.assetKey === "__SOL__";
        const isNothing = rw.assetKey === "__NOTHING__";
        const isNFT = asset.isNFT === true;
        const decimals: number = asset.decimals ?? 9;
        const rawAmount = isNothing 
          ? 0 
          : isNFT 
            ? 1 
            : Math.round(parseFloat(rw.amountPerWin || "0") * Math.pow(10, decimals));

        let prizeType: "Sol" | "SplToken" | "Nft" = "SplToken";
        if (isSol || isNothing) prizeType = "Sol";
        else if (isNFT) prizeType = "Nft";

        let tokenMint: PublicKey;
        try {
          tokenMint = (isSol || isNothing) ? PublicKey.default : new PublicKey(asset.mint);
        } catch {
          toast.error(`Invalid public key for reward item ${i + 1}`);
          setLoading(false);
          setStep("");
          return;
        }

        prizesParams.push({
          prizeIndex: i,
          prizeType,
          tokenMint,
          amount: rawAmount,
          winPercentage: Math.round(parseFloat(rw.winPct || "0")),
          totalCount: isNothing ? 999999 : isNFT ? 1 : (parseInt(rw.totalCount) || 1),
        });
      }

      setStep("Creating box and registering rewards on-chain…");
      await createBoxWithPrizesTx(wallet, {
        box: {
          slug,
          boxId: nextId,
          priceLamports,
          acceptedMints: mintsPk,
          acceptedPrices: priceArr,
          supply: Number(supply) || 0,
          startTime,
          endTime: datetimeLocalToUnix(endStr),
        },
        prizes: prizesParams,
      });
      toast.success(`Box "${name.trim()}" created successfully with rewards!`);

      if (typeof window !== "undefined") {
        localStorage.setItem(
          `box_branding_${slug}_${nextId}`,
          JSON.stringify({
            name: name.trim(),
            description: desc.trim(),
            bannerUri: banner.trim(),
          })
        );
      }

      // Delay to let validator index account state completely
      await new Promise(resolve => setTimeout(resolve, 1500));
      onDone();
    } catch (e: any) { setErr(getSolanaErrorDetails(e)); }
    finally { setLoading(false); setStep(""); }
  }, [wallet, slug, name, desc, banner, supply, startStr, endStr, payOpts, rewards, cumulativeWinPct, onDone]);

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-2xl space-y-5 max-h-[90vh] overflow-y-auto rounded-3xl p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-[#2d5a3f] hover:text-[#0f2618] transition-colors p-2 bg-[#1cac64]/8 rounded-full hover:bg-white/10"
        >
          ✕
        </button>

        <h2 className="text-xl font-black text-[#0f2618] uppercase tracking-wider">
          Create New Box — {slug}
        </h2>

        {/* Basic fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Name *" val={name} onChange={setName} mdFull />
          <Field label="Description" val={desc} onChange={setDesc} rows={2} mdFull />
          <ImageUpload label="Banner Image" value={banner} onChange={setBanner} className="md:col-span-2" />
          <Field label="Supply" val={supply} onChange={setSupply} type="number" />
          <Field label="Start" val={startStr} onChange={setStart} type="datetime-local" />
          <Field label="End"   val={endStr}   onChange={setEnd}   type="datetime-local" />
        </div>

        {/* ── Accepted Payment Tokens ──────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[#2d5a3f] uppercase tracking-wider">Accepted Payment Tokens</p>
            {payOpts.length < 3 && (
              <button
                onClick={() => setPayOpts(prev => [...prev, { id: nextPayId, mintKey: "", customMint: "", price: "0" }])}
                className="text-[10px] px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/25 hover:bg-amber-500/20 transition font-semibold"
              >+ Add Token ({payOpts.length}/3)</button>
            )}
          </div>

          {payOpts.map((po) => (
            <div key={po.id} className="flex flex-col gap-1.5 p-3 bg-[#ffffff]/40 border border-[#1cac64]/15 rounded-xl group relative">
              <div className="flex gap-2 items-center">
                <select
                  value={po.mintKey}
                  onChange={e => updatePay(po.id, "mintKey", e.target.value)}
                  className="flex-1 bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2.5 py-1.5 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
                >
                  {tokenOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input
                  placeholder="price"
                  type="number"
                  value={po.price}
                  onChange={e => updatePay(po.id, "price", e.target.value)}
                  className="w-24 bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2.5 py-1.5 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
                />
                {payOpts.length > 1 && (
                  <button
                    onClick={() => setPayOpts(prev => prev.filter(p => p.id !== po.id))}
                    className="text-[#4a7d5e] hover:text-red-600 text-sm transition p-1 rounded hover:bg-red-500/10"
                    title="Remove"
                  >✕</button>
                )}
              </div>
              {po.mintKey === "CUSTOM" && (
                <input
                  placeholder="Enter custom mint address (e.g. EPjFWdd…)"
                  value={po.customMint}
                  onChange={e => updatePay(po.id, "customMint", e.target.value)}
                  className="bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2.5 py-1.5 text-xs font-mono text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
                />
              )}
            </div>
          ))}
        </div>

        {/* ── Box Prizes & Rewards (from Vault) ───────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[#2d5a3f] uppercase tracking-wider">🎁 Box Prizes &amp; Rewards <span className="text-[#4a7d5e] normal-case">(from vault)</span></p>
            <button
              onClick={() => setRewards(prev => [...prev, { id: nextRewardId, assetKey: rewardAssetOptions[0]?.value ?? "", amountPerWin: "1", totalCount: "1", winPct: "5" }])}
              className="text-[10px] px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-600 border border-emerald-500/25 hover:bg-emerald-500/20 transition font-semibold"
            >+ Add Reward</button>
          </div>

          {rewards.length === 0 && (
            <p className="text-[11px] text-[#4a7d5e] italic text-center py-3">No rewards configured. Click &quot;+ Add Reward&quot; to add prizes from the vault.</p>
          )}

          {rewards.map((rw) => {
            const asset = resolveRewardAsset(rw.assetKey);
            const isNFT = asset?.isNFT === true;
            const isNothing = rw.assetKey === "__NOTHING__";
            return (
              <div key={rw.id} className="p-3 bg-[#ffffff]/40 border border-[#1cac64]/15 rounded-xl space-y-2">
                {/* Row 1: asset selector + avatar */}
                <div className="flex gap-2 items-center">
                  {asset && <AssetAvatar asset={asset} />}
                  <select
                    value={rw.assetKey}
                    onChange={e => updateReward(rw.id, "assetKey", e.target.value)}
                    className="flex-1 bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2.5 py-1.5 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
                  >
                    <option value="">— Select Vault Asset —</option>
                    {rewardAssetOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setRewards(prev => prev.filter(r => r.id !== rw.id))}
                    className="text-[#4a7d5e] hover:text-red-600 text-sm transition p-1 rounded hover:bg-red-500/10"
                    title="Remove reward"
                  >✕</button>
                </div>
                {/* Row 2: amount / count / win% */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-[#3d6b4e] mb-0.5 block">{isNothing ? "Amount" : isNFT ? "Qty" : "Amt / Win"}</label>
                    <input
                      type="number"
                      value={isNothing ? "0" : isNFT ? "1" : rw.amountPerWin}
                      onChange={e => !isNFT && !isNothing && updateReward(rw.id, "amountPerWin", e.target.value)}
                      disabled={isNFT || isNothing}
                      className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2 py-1 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 disabled:opacity-40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#3d6b4e] mb-0.5 block">Total Count</label>
                    <input
                      type="number"
                      value={isNothing ? "999999" : isNFT ? "1" : rw.totalCount}
                      onChange={e => !isNFT && !isNothing && updateReward(rw.id, "totalCount", e.target.value)}
                      disabled={isNFT || isNothing}
                      className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2 py-1 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 disabled:opacity-40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#3d6b4e] mb-0.5 block">Win %</label>
                    <input
                      type="number"
                      value={rw.winPct}
                      onChange={e => updateReward(rw.id, "winPct", e.target.value)}
                      className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-2 py-1 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
                      min="0" max="100" step="0.1"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Cumulative Win-Rate Gauge */}
          {rewards.length > 0 && (
            <div className={`flex items-center justify-between p-2.5 rounded-xl border text-xs font-semibold ${
              cumulativeWinPct > 100
                ? "bg-red-500/10 border-red-500/20 text-red-700"
                : cumulativeWinPct > 80
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-700"
                  : "bg-emerald-500/10 border-emerald-500/20 text-emerald-700"
            }`}>
              <span>Cumulative Win Rate</span>
              <span className="font-mono text-sm">{cumulativeWinPct.toFixed(1)}% / 100%</span>
            </div>
          )}
        </div>

        {/* ── Error / step ── */}
        {step && <p className="text-amber-700 text-xs p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl animate-pulse">{step}</p>}
        {err && <p className="text-red-700 text-xs p-3 bg-red-500/10 border border-red-500/20 rounded-xl">{err}</p>}

        {/* ── Actions ── */}
        <div className="flex gap-3 pt-3 border-t border-[#1cac64]/15">
          <button onClick={onClose} className="flex-1 py-3 px-4 border border-[#1cac64]/20 rounded-xl text-xs font-bold uppercase tracking-wider text-[#1a3a2a] bg-[#1cac64]/8 hover:bg-[#c8edba]/50 transition">Cancel</button>
          <button onClick={submit} disabled={loading || !name.trim()}
            className="flex-1 py-3 px-4 rounded-xl font-bold uppercase tracking-wider text-xs bg-gradient-to-r from-emerald-500 to-teal-500 text-[#0f2618] hover:from-emerald-400 hover:to-teal-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50">
            {loading ? (step || "Creating…") : (rewards.length > 0 ? `Create Box + ${rewards.length} Reward${rewards.length > 1 ? "s" : ""}` : "Create Box")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   PRIZE ITEM MANAGER
   - Deposit reward/prize tokens directly using live wallet assets dropdown.
   - Withdraw reward/prize tokens directly using live vault assets dropdown.
═══════════════════════════════════════════════════════════════════════════════ */

function PrizeItemManager({
  box, slug, onClose, onDone, walletAssets, vaultAssets
}: {
  box: any;
  slug: string;
  onClose: () => void;
  onDone: () => void;
  walletAssets: any[];
  vaultAssets: any[];
}) {
  const wallet = useWallet();
  const id = box.boxId?.toNumber?.() ?? box.boxId ?? 0;
  const [mint, setMint]       = useState("");
  const [amount, setAmount]   = useState("1");
  const [loading, setLoading] = useState(false);
  const [actionErr, setActionErr] = useState("");
  const [isDepositMode, setIsDepositMode] = useState<boolean>(true);
  const [selectedAsset, setSelectedAsset] = useState<any>(null);

  const prizePda = useMemo(() => {
    const pgId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
    const boxPk = new PublicKey(box.pubkey);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxPk.toBuffer(), Buffer.from([0])],
      pgId,
    )[0];
  }, [box.pubkey]);

  const selectOptions = useMemo(() => {
    const assets = isDepositMode ? walletAssets : vaultAssets;
    const opts = assets.map((t, idx) => ({
      value: String(idx),
      label: `${t.name} (${t.uiAmount} available)`
    }));
    opts.push({ value: "CUSTOM", label: "Custom Mint Address..." });
    opts.push({ value: "", label: "-- Select Token/NFT --" });
    return opts;
  }, [isDepositMode, walletAssets, vaultAssets]);

  const handleSelectAsset = (val: string) => {
    setActionErr("");
    if (val === "CUSTOM") {
      setSelectedAsset({ mint: "", name: "Custom Asset", uiAmount: 0, decimals: 9 });
      setMint("");
      setAmount("1");
    } else if (val === "") {
      setSelectedAsset(null);
      setMint("");
      setAmount("1");
    } else {
      const idx = parseInt(val);
      const asset = (isDepositMode ? walletAssets : vaultAssets)[idx];
      setSelectedAsset(asset);
      setMint(asset.mint);
      setAmount(String(asset.uiAmount));
    }
  };

  const handleDeposit = useCallback(async () => {
    if (!wallet.publicKey) { toast.error("Connect wallet first"); return; }
    if (!mint) { setActionErr("Please select or paste an asset mint"); return; }
    let tokenMintPk: PublicKey;
    try {
      tokenMintPk = new PublicKey(mint.trim());
    } catch {
      setActionErr("Invalid token mint address");
      return;
    }
    setLoading(true); setActionErr("");
    try {
      const decimals = selectedAsset?.decimals ?? 9;
      const rawAmount = Math.round((Number(amount) || 0) * Math.pow(10, decimals));
      await depositPrizeTx(wallet, {
        slug, boxId: id, prizeIndex: 0,
        tokenMint: tokenMintPk,
        amount: rawAmount,
      });
      toast.success(`Deposited ${amount} tokens into vault prize item!`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      onDone();
    } catch (e: any) { setActionErr(getSolanaErrorDetails(e)); }
    finally { setLoading(false); }
  }, [wallet, slug, id, mint, amount, selectedAsset, onDone]);

  const handleWithdraw = useCallback(async () => {
    if (!wallet.publicKey) { toast.error("Connect wallet first"); return; }
    if (!mint) { setActionErr("Please select or paste an asset mint"); return; }
    let tokenMintPk: PublicKey;
    try {
      tokenMintPk = new PublicKey(mint.trim());
    } catch {
      setActionErr("Invalid token mint address");
      return;
    }
    setLoading(true); setActionErr("");
    try {
      await withdrawPrizeTx(wallet, {
        slug, boxId: id, prizeIndex: 0,
        tokenMint: tokenMintPk,
      });
      toast.success("Prize withdrawn from vault!");
      await new Promise(resolve => setTimeout(resolve, 1500));
      onDone();
    } catch (e: any) { setActionErr(getSolanaErrorDetails(e)); }
    finally { setLoading(false); }
  }, [wallet, slug, id, mint, onDone]);

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-md rounded-3xl p-6 space-y-5 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-[#2d5a3f] hover:text-[#0f2618] transition-colors p-2 bg-[#1cac64]/8 rounded-full hover:bg-white/10"
        >
          ✕
        </button>

        <h2 className="text-xl font-black text-[#0f2618] uppercase tracking-wider">
          Manage Prize — Box #{id}
        </h2>

        {/* Tab Selector */}
        <div className="grid grid-cols-2 bg-[#1cac64]/5 p-1 border border-[#1cac64]/15 rounded-xl">
          <button
            onClick={() => { setIsDepositMode(true); setSelectedAsset(null); setMint(""); }}
            className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
              isDepositMode
                ? "bg-[#1cac64]/15 text-[#1cac64] border border-[#1cac64]/20 shadow-sm"
                : "text-[#3d6b4e] hover:text-[#0f2618]"
            }`}
          >
            Deposit Mode
          </button>
          <button
            onClick={() => { setIsDepositMode(false); setSelectedAsset(null); setMint(""); }}
            className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
              !isDepositMode
                ? "bg-[#1cac64]/15 text-[#1cac64] border border-[#1cac64]/20 shadow-sm"
                : "text-[#3d6b4e] hover:text-[#0f2618]"
            }`}
          >
            Withdraw Mode
          </button>
        </div>

        <div className="space-y-1 text-xs">
          <div className="text-[#3d6b4e] flex justify-between">
            <span>Prize Item PDA (idx=0):</span>
            <span className="font-mono text-[#0f2618] break-all">{prizePda.toBase58().slice(0, 10)}…{prizePda.toBase58().slice(-10)}</span>
          </div>
        </div>

        {/* Asset Selector */}
        <div className="space-y-1">
          <label className="block text-xs text-[#2d5a3f] font-bold">Select Token/NFT from {isDepositMode ? "Wallet" : "Vault"}</label>
          <select
            onChange={e => handleSelectAsset(e.target.value)}
            className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-3 py-2 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
          >
            {selectOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Mint Address Fallback / Copy Paste */}
        <div className="space-y-1">
          <label className="block text-xs text-[#2d5a3f] font-bold">Token Mint Address</label>
          <input
            value={mint}
            onChange={e => setMint(e.target.value)}
            placeholder="EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v..."
            className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-3 py-2 text-xs font-mono text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
          />
        </div>

        {/* Amount Input */}
        <div>
          <label className="block text-xs text-[#2d5a3f] font-bold">Amount to Deposit/Withdraw</label>
          <div className="relative mt-1">
            <input
              type="number" 
              value={amount} 
              onChange={e => setAmount(e.target.value)}
              className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-3 py-2 text-xs text-[#0f2618] focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
              placeholder="1"
            />
            {selectedAsset && (
              <button
                onClick={() => setAmount(String(selectedAsset.uiAmount))}
                className="absolute right-2 top-1.5 px-2 py-0.5 text-[9px] bg-[#1cac64]/10 border border-[#1cac64]/20 text-[#1cac64] rounded hover:bg-[#1cac64]/20 transition-all"
              >
                MAX
              </button>
            )}
          </div>
        </div>

        {actionErr && <p className="text-red-700 text-xs p-3 bg-red-500/10 border border-red-500/20 rounded-xl">{actionErr}</p>}
        
        <div className="pt-3 border-t border-[#1cac64]/15">
          {isDepositMode ? (
            <button onClick={handleDeposit} disabled={loading} className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-[#0f2618] text-xs font-bold hover:from-emerald-400 hover:to-teal-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_30px_rgba(16,185,129,0.5)] disabled:opacity-50">⬇ Deposit Prize into Box</button>
          ) : (
            <button onClick={handleWithdraw} disabled={loading} className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-black text-xs font-bold hover:from-amber-400 hover:to-yellow-400 transition-all shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)] disabled:opacity-50">⬆ Withdraw Prize from Box</button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   PREMIUM VAULT MANAGER MODAL
   - Shows live, side-by-side comparative grid of Admin Wallet vs Vault PDA assets.
   - Allows instant Deposits and CPI-based or Native administrative Withdrawals.
═══════════════════════════════════════════════════════════════════════════════ */

function VaultManager({
  slug,
  onClose,
  onDone,
  walletSol,
  vaultSol,
  walletAssets,
  vaultAssets,
  loadingAssets,
  assetsError,
  onRefreshAssets,
  rentClaimMode
}: {
  slug: string;
  onClose: () => void;
  onDone: () => void;
  walletSol: number | null;
  vaultSol: number | null;
  walletAssets: any[];
  vaultAssets: any[];
  loadingAssets: boolean;
  assetsError: string;
  onRefreshAssets: () => void;
  rentClaimMode?: number;
}) {
  const wallet = useWallet();
  const pgId   = useMemo(() => new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4"), []);
  const conn   = useMemo(() => new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed"), []);
  const projPk = useMemo(() => PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], pgId)[0], [slug, pgId]);
  const vaultPk = useMemo(
    () => PublicKey.findProgramAddressSync([Buffer.from("vault"), projPk.toBuffer()], pgId)[0],
    [projPk, pgId],
  );

  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [actionErr, setActionErr]    = useState("");
  const [txLoading, setTxLoading]    = useState(false);

  const [actionModal, setActionModal] = useState<{
    type: "deposit" | "withdraw";
    asset: {
      mint: string;
      isSol: boolean;
      name: string;
      decimals: number;
      maxAmount: number;
      isNFT?: boolean;
      image?: string;
    } | null;
  }>({ type: "deposit", asset: null });

  const [amountStr, setAmountStr] = useState("");

  const [selectedWalletNfts, setSelectedWalletNfts] = useState<string[]>([]);
  const [selectedVaultNfts, setSelectedVaultNfts] = useState<string[]>([]);

  const walletNfts = useMemo(() => walletAssets.filter(a => a.isNFT), [walletAssets]);
  const vaultNfts = useMemo(() => vaultAssets.filter(a => a.isNFT), [vaultAssets]);

  const handleToggleWalletNft = useCallback((mint: string) => {
    setSelectedWalletNfts(prev => 
      prev.includes(mint) ? prev.filter(m => m !== mint) : [...prev, mint]
    );
  }, []);

  const handleToggleVaultNft = useCallback((mint: string) => {
    setSelectedVaultNfts(prev => 
      prev.includes(mint) ? prev.filter(m => m !== mint) : [...prev, mint]
    );
  }, []);

  // Automatically refresh assets when the premium vault manager is mounted
  useEffect(() => {
    onRefreshAssets();
  }, [onRefreshAssets]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const acc = await retryWithBackoff(() => conn.getAccountInfo(vaultPk), "getAccountInfo(vault)");
        if (!cancel) {
          setVaultExists(acc !== null);
        }
      } catch (e) {
        console.error("Failed to check vault existence:", e);
      }
    })();
    return () => { cancel = true; };
  }, [vaultPk, conn]);

  const handleInitVault = useCallback(async () => {
    if (!wallet.publicKey) { toast.error("Connect wallet first"); return; }
    setActionErr("");
    setTxLoading(true);
    try {
      const pgId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
      const [platform] = PublicKey.findProgramAddressSync([Buffer.from("platform")], pgId);
      const [project]  = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], pgId);
      const [vault]    = PublicKey.findProgramAddressSync([Buffer.from("vault"), project.toBuffer()], pgId);
      const ix = buildIx("initialize_vault", {
        project:           { pubkey: project,              isSigner: false, isWritable: false },
        vault:             { pubkey: vault,                isSigner: false, isWritable: true  },
        tenant:            { pubkey: wallet.publicKey!,    isSigner: true,  isWritable: false },
        system_program:    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      }, [slug]);
      
      const tx = new Transaction().add(ix);
      tx.feePayer = wallet.publicKey;
      const { blockhash } = (await retryWithBackoff(() => conn.getLatestBlockhash(), "getLatestBlockhash(initVault)")) as unknown as { blockhash: string };
      tx.recentBlockhash = blockhash;
      const signed = await wallet.signTransaction!(tx as any);
      const sig = await retryWithBackoff(
        () => conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" }),
        "sendRawTransaction(initVault)",
      );
      await retryWithBackoff(() => conn.confirmTransaction(sig, "confirmed"), "confirmTransaction(initVault)");
      toast.success("Vault initialized! ✅");
      setVaultExists(true);
      onDone();
    } catch (e: any) { setActionErr(getSolanaErrorDetails(e)); }
    finally { setTxLoading(false); }
  }, [wallet, slug, onDone, conn]);

  const handleExecuteAction = useCallback(async () => {
    if (!wallet.publicKey || !actionModal.asset) return;
    setTxLoading(true);
    setActionErr("");
    
    const { mint, isSol, name, decimals, isNFT } = actionModal.asset;
    const amount = isNFT ? "1" : amountStr.trim();
    
    try {
      if (actionModal.type === "deposit") {
        if (isSol) {
          const lamports = Math.round(parseFloat(amount) * 1e9);
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey!,
              toPubkey: vaultPk,
              lamports,
            })
          );
          tx.feePayer = wallet.publicKey!;
          const { blockhash } = await conn.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          const signed = await wallet.signTransaction!(tx);
          const sig = await conn.sendRawTransaction(signed.serialize());
          await conn.confirmTransaction(sig, "confirmed");
          toast.success(`Deposited ${amount} SOL into vault!`);
        } else {
          const tokenMint = new PublicKey(mint);
          const walletAta = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey!);
          const vaultAta = getAssociatedTokenAddressSync(tokenMint, vaultPk, true);

          const tx = new Transaction();
          const vaultAtaInfo = await conn.getAccountInfo(vaultAta);
          if (!vaultAtaInfo) {
            tx.add(
              createAssociatedTokenAccountInstruction(
                wallet.publicKey!,
                vaultAta,
                vaultPk,
                tokenMint
              )
            );
          }

          const rawAmount = isNFT ? 1 : Math.round(parseFloat(amount) * Math.pow(10, decimals));
          tx.add(
            createTransferInstruction(
              walletAta,
              vaultAta,
              wallet.publicKey!,
              rawAmount
            )
          );

          tx.feePayer = wallet.publicKey!;
          const { blockhash } = await conn.getLatestBlockhash();
          tx.recentBlockhash = blockhash;
          const signed = await wallet.signTransaction!(tx);
          const sig = await conn.sendRawTransaction(signed.serialize());
          await conn.confirmTransaction(sig, "confirmed");
          toast.success(isNFT ? `Deposited NFT ${name} into vault!` : `Deposited ${amount} ${name} into vault!`);
        }
      } else {
        if (isSol) {
          const lamports = Math.round(parseFloat(amount) * 1e9);
          await withdrawVaultSolTx(wallet, {
            slug,
            amountLamports: lamports
          });
          toast.success(`Withdrew ${amount} SOL from vault!`);
        } else {
          const rawAmount = isNFT ? 1 : Math.round(parseFloat(amount) * Math.pow(10, decimals));
          await withdrawVaultTokenTx(wallet, {
            slug,
            tokenMint: new PublicKey(mint),
            amount: rawAmount
          });
          toast.success(isNFT ? `Withdrew NFT ${name} from vault!` : `Withdrew ${amount} ${name} from vault!`);
        }
      }
      
      setActionModal({ type: "deposit", asset: null });
      setAmountStr("");
      onRefreshAssets();
    } catch (e: any) {
      console.error(e);
      setActionErr(getSolanaErrorDetails(e));
    } finally {
      setTxLoading(false);
    }
  }, [wallet, actionModal, amountStr, vaultPk, conn, slug, onRefreshAssets]);

  const handleBulkDepositNfts = useCallback(async () => {
    if (!wallet.publicKey || selectedWalletNfts.length === 0) return;
    setTxLoading(true);
    setActionErr("");
    
    try {
      toast.loading(`Preparing bulk deposit of ${selectedWalletNfts.length} NFTs...`, { id: "bulk-deposit" });

      const batchSize = 4;
      const mints = [...selectedWalletNfts];
      let successCount = 0;

      for (let i = 0; i < mints.length; i += batchSize) {
        const batch = mints.slice(i, i + batchSize);
        const tx = new Transaction();

        toast.loading(`Depositing NFT batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(mints.length / batchSize)}...`, { id: "bulk-deposit" });

        for (const mint of batch) {
          const tokenMint = new PublicKey(mint);
          const walletAta = getAssociatedTokenAddressSync(tokenMint, wallet.publicKey!);
          const vaultAta = getAssociatedTokenAddressSync(tokenMint, vaultPk, true);

          const vaultAtaInfo = await conn.getAccountInfo(vaultAta);
          if (!vaultAtaInfo) {
            tx.add(
              createAssociatedTokenAccountInstruction(
                wallet.publicKey!,
                vaultAta,
                vaultPk,
                tokenMint
              )
            );
          }

          tx.add(
            createTransferInstruction(
              walletAta,
              vaultAta,
              wallet.publicKey!,
              1
            )
          );
        }

        tx.feePayer = wallet.publicKey!;
        const { blockhash } = await conn.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        const signed = await wallet.signTransaction!(tx);
        const sig = await conn.sendRawTransaction(signed.serialize());
        await conn.confirmTransaction(sig, "confirmed");
        successCount += batch.length;
      }
      
      toast.success(`Successfully deposited ${successCount} NFTs! 🎉`, { id: "bulk-deposit" });
      setSelectedWalletNfts([]);
      onRefreshAssets();
    } catch (e: any) {
      console.error(e);
      setActionErr(getSolanaErrorDetails(e));
      toast.error("Failed to deposit NFTs", { id: "bulk-deposit" });
    } finally {
      setTxLoading(false);
    }
  }, [wallet, selectedWalletNfts, vaultPk, conn, onRefreshAssets]);

  const handleBulkWithdrawNfts = useCallback(async () => {
    if (!wallet.publicKey || selectedVaultNfts.length === 0) return;
    setTxLoading(true);
    setActionErr("");
    
    try {
      toast.loading(`Preparing bulk withdrawal of ${selectedVaultNfts.length} NFTs...`, { id: "bulk-withdraw" });

      const batchSize = 4;
      const mints = [...selectedVaultNfts];
      let successCount = 0;

      const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const ATA_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

      const [platformPda] = PublicKey.findProgramAddressSync([Buffer.from("platform")], pgId);
      const [projectPda] = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], pgId);
      const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), projectPda.toBuffer()], pgId);

      for (let i = 0; i < mints.length; i += batchSize) {
        const batch = mints.slice(i, i + batchSize);
        const tx = new Transaction();

        toast.loading(`Withdrawing NFT batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(mints.length / batchSize)}...`, { id: "bulk-withdraw" });

        for (const mint of batch) {
          const tokenMint = new PublicKey(mint);
          const vaultAta = PublicKey.findProgramAddressSync(
            [vaultPda.toBuffer(), TOKEN_PROG.toBuffer(), tokenMint.toBuffer()],
            ATA_PROG
          )[0];
          const signerAta = PublicKey.findProgramAddressSync(
            [wallet.publicKey!.toBuffer(), TOKEN_PROG.toBuffer(), tokenMint.toBuffer()],
            ATA_PROG
          )[0];

          const ix = buildIx("withdraw_vault_token", {
            platform: { pubkey: platformPda, isSigner: false, isWritable: false },
            project: { pubkey: projectPda, isSigner: false, isWritable: false },
            vault: { pubkey: vaultPda, isSigner: false, isWritable: true },
            token_mint: { pubkey: tokenMint, isSigner: false, isWritable: false },
            vault_token_account: { pubkey: vaultAta, isSigner: false, isWritable: true },
            authority_token_account: { pubkey: signerAta, isSigner: false, isWritable: true },
            authority: { pubkey: wallet.publicKey!, isSigner: true, isWritable: true },
            token_program: { pubkey: TOKEN_PROG, isSigner: false, isWritable: false },
            associated_token_program: { pubkey: ATA_PROG, isSigner: false, isWritable: false },
            system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          }, [
            slug,
            1
          ]);

          tx.add(ix);
        }

        tx.feePayer = wallet.publicKey!;
        const { blockhash } = await conn.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        const signed = await wallet.signTransaction!(tx);
        const sig = await conn.sendRawTransaction(signed.serialize());
        await conn.confirmTransaction(sig, "confirmed");
        successCount += batch.length;
      }
      
      toast.success(`Successfully withdrew ${successCount} NFTs! 🎉`, { id: "bulk-withdraw" });
      setSelectedVaultNfts([]);
      onRefreshAssets();
    } catch (e: any) {
      console.error(e);
      setActionErr(getSolanaErrorDetails(e));
      toast.error("Failed to withdraw NFTs", { id: "bulk-withdraw" });
    } finally {
      setTxLoading(false);
    }
  }, [wallet, selectedVaultNfts, slug, pgId, conn, onRefreshAssets]);

  const handleCloseVaultAta = useCallback(async (mintStr: string) => {
    if (!wallet.publicKey) return;
    setTxLoading(true);
    setActionErr("");
    const toastId = "close-ata";
    try {
      toast.loading("Closing empty token account & reclaiming rent...", { id: toastId });
      await closeVaultTokenAccountTx(wallet, {
        slug,
        tokenMint: new PublicKey(mintStr),
      });
      toast.success("Token account closed! ~0.002 SOL reclaimed ✅", { id: toastId });
      onRefreshAssets();
    } catch (e: any) {
      console.error(e);
      setActionErr(getSolanaErrorDetails(e));
      toast.error("Failed to close token account", { id: toastId });
    } finally {
      setTxLoading(false);
    }
  }, [wallet, slug, onRefreshAssets]);

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="glass-panel-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl relative">
        
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-5 border-b border-[#1cac64]/20 bg-[#ebfde3]/40">
          <div>
            <h3 className="text-lg font-black text-[#0f2618] flex items-center gap-2">
              <span>💰 Premium Vault Manager</span>
              <span className="text-xs bg-[#1cac64]/10 text-[#1cac64] border border-[#1cac64]/20 px-2 py-0.5 rounded-full font-semibold font-mono">
                {slug}
              </span>
            </h3>
            <p className="text-xs text-[#2d5a3f] mt-1">Manage project rewards, tokens, and native SOL reserves.</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={onRefreshAssets}
              disabled={loadingAssets}
              className={`p-2 rounded-lg border border-[#1cac64]/20 text-[#2d5a3f] hover:text-[#0f2618] hover:border-[#1cac64]/50 transition duration-150 ${loadingAssets ? 'animate-spin' : ''}`}
              title="Refresh balances"
            >
              ↻
            </button>
            <button onClick={onClose} className="text-[#2d5a3f] hover:text-[#0f2618] text-sm p-2 rounded-lg hover:bg-[#c8edba]/50 transition">✕</button>
          </div>
        </div>

        {/* Inner Scrollable Layout */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Vault PDA and Status */}
          <div className="p-4 rounded-xl bg-[#ebfde3]/60 border border-[#1cac64]/15 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-[#3d6b4e] font-bold block">Vault PDA Treasury Address</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-[#0f2618] font-bold break-all">{vaultPk.toBase58()}</span>
                <button
                  onClick={() => { navigator.clipboard?.writeText(vaultPk.toBase58()); toast.success("Vault PDA copied!"); }}
                  className="text-[#2d5a3f] hover:text-[#1cac64] p-1 transition"
                  title="Copy Address"
                >
                  📋
                </button>
              </div>
            </div>
            <div>
              {vaultExists === null ? (
                <span className="text-xs text-[#3d6b4e] animate-pulse">Checking status…</span>
              ) : vaultExists ? (
                <span className="text-xs px-3 py-1 bg-green-500/10 text-green-700 border border-green-500/20 rounded-full font-semibold">
                  ✓ Vault Initialized
                </span>
              ) : (
                <button
                  onClick={handleInitVault}
                  disabled={txLoading}
                  className="px-4 py-2 text-xs font-bold bg-[#1cac64] text-white rounded-lg hover:bg-[#1cac64]/90 shadow-sm transition"
                >
                  ⚡ Initialize Vault PDA
                </button>
              )}
            </div>
          </div>

          {actionErr && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-700 rounded-xl text-xs break-all">
              {actionErr}
            </div>
          )}

          {assetsError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-700 rounded-xl text-xs break-all flex items-center justify-between">
              <span>⚠️ Error loading on-chain assets: {assetsError}</span>
              <button 
                onClick={onRefreshAssets} 
                disabled={loadingAssets} 
                className="underline font-bold text-red-700 hover:text-red-500 ml-2 shrink-0 disabled:opacity-40"
              >
                Retry
              </button>
            </div>
          )}

          {/* Two-Column Assets Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Left Column: Admin Wallet */}
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b border-[#1cac64]/20 pb-2">
                <h4 className="font-bold text-[#0f2618] text-sm flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                  Admin Wallet (Funding Source)
                </h4>
                <span className="text-[10px] text-[#3d6b4e] font-mono">
                  {wallet.publicKey?.toBase58().slice(0, 6)}…{wallet.publicKey?.toBase58().slice(-6)}
                </span>
              </div>

              {/* SOL Balance */}
              <div className="p-4 rounded-xl bg-[#ffffff]/60 border border-[#1cac64]/15 hover:border-[#1cac64]/25 hover:bg-[#ffffff]/80 transition-all flex justify-between items-center shadow-md">
                <div className="flex items-center gap-3">
                  <img 
                    src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" 
                    alt="SOL" 
                    className="w-8 h-8 rounded-full border border-[#1cac64]/20 bg-[#d9f5cc] shrink-0"
                  />
                  <div>
                    <span className="text-xs text-[#3d6b4e] block">Solana</span>
                    <span className="text-xl font-bold text-[#0f2618] font-mono mt-0.5 block">
                      {walletSol !== null ? walletSol.toFixed(4) : "0.0000"}{" "}
                      <span className="text-xs font-semibold text-[#2d5a3f]">SOL</span>
                    </span>
                  </div>
                </div>
                {vaultExists && (
                  <button
                    onClick={() => setActionModal({
                      type: "deposit",
                      asset: { mint: PublicKey.default.toBase58(), isSol: true, name: "SOL", decimals: 9, maxAmount: walletSol || 0, image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" }
                    })}
                    className="px-3 py-1.5 text-xs font-bold bg-[#1cac64]/10 border border-[#1cac64]/20 hover:border-[#1cac64] hover:bg-[#1cac64]/20 text-[#1cac64] rounded-lg transition"
                  >
                    Deposit ⬇
                  </button>
                )}
              </div>

              {/* SPL Tokens & NFTs */}
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#2d5a3f] block">SPL & NFT Assets</span>
                    {walletNfts.length > 0 && (
                      <button
                        onClick={() => {
                          const allMintIds = walletNfts.map(n => n.mint);
                          const allSelected = allMintIds.every(id => selectedWalletNfts.includes(id));
                          if (allSelected) {
                            setSelectedWalletNfts(prev => prev.filter(id => !allMintIds.includes(id)));
                          } else {
                            setSelectedWalletNfts(prev => Array.from(new Set([...prev, ...allMintIds])));
                          }
                        }}
                        className="text-[9px] text-[#1cac64] hover:text-[#1cac64]/80 font-semibold transition"
                      >
                        {walletNfts.every(n => selectedWalletNfts.includes(n.mint)) ? "Deselect All NFTs" : "Select All NFTs"}
                      </button>
                    )}
                  </div>
                  {selectedWalletNfts.length > 0 && (
                    <button
                      onClick={handleBulkDepositNfts}
                      disabled={txLoading}
                      className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-[#0f2618] text-[10px] font-bold hover:from-emerald-400 hover:to-teal-400 transition cursor-pointer shadow-sm disabled:opacity-40"
                    >
                      Deposit Selected ({selectedWalletNfts.length}) ⬇
                    </button>
                  )}
                </div>
                {walletAssets.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#4a7d5e] border border-dashed border-[#1cac64]/20 rounded-xl">
                    No active SPL tokens or NFTs found in wallet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 max-h-[220px] overflow-y-auto pr-1">
                    {walletAssets.map((asset: any) => (
                      <div key={asset.ata} className={`p-3 rounded-xl bg-[#ffffff]/40 border border-[#1cac64]/15 flex justify-between items-center transition hover:border-[#1cac64]/30 hover:bg-[#ffffff]/60`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          {asset.isNFT && (
                            <input
                              type="checkbox"
                              checked={selectedWalletNfts.includes(asset.mint)}
                              onChange={() => handleToggleWalletNft(asset.mint)}
                              className="w-4 h-4 rounded border-[#1cac64]/20 bg-white text-[#1cac64] focus:ring-[#1cac64]/20 focus:ring-offset-0 focus:outline-none"
                            />
                          )}
                          <AssetAvatar asset={asset} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-xs text-[#0f2618] truncate">{asset.name}</span>
                              {asset.isNFT && (
                                <span className="text-[8px] px-1 py-0.2 bg-[#1cac64]/20 text-[#1cac64] border border-[#1cac64]/30 rounded font-semibold font-mono uppercase tracking-wider shrink-0">NFT</span>
                              )}
                            </div>
                            <span className="font-mono text-[9px] text-[#4a7d5e] block truncate">{asset.mint}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs font-bold text-[#0f2618] font-mono">{asset.uiAmount}</span>
                          {vaultExists && (
                            <button
                              onClick={() => setActionModal({
                                type: "deposit",
                                asset: { mint: asset.mint, isSol: false, name: asset.name, decimals: asset.decimals, maxAmount: asset.uiAmount, isNFT: asset.isNFT, image: asset.image }
                              })}
                              className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-[#0f2618] text-[10px] font-bold hover:from-emerald-400 hover:to-teal-400 transition cursor-pointer shadow-sm"
                            >
                              Deposit ⬇
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Vault PDA */}
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b border-[#1cac64]/20 pb-2">
                <h4 className="font-bold text-[#0f2618] text-sm flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  Vault PDA (Project Treasury)
                </h4>
                <span className="text-xs bg-[#1cac64]/10 text-[#1cac64] border border-[#1cac64]/20 px-2 py-0.5 rounded-full font-mono font-bold">
                  {vaultExists ? "Ready" : "Inactive"}
                </span>
              </div>

              {/* SOL Balance */}
              <div className="p-4 rounded-xl bg-[#ffffff]/60 border border-[#1cac64]/15 hover:border-[#1cac64]/25 hover:bg-[#ffffff]/80 transition-all flex justify-between items-center shadow-md">
                <div className="flex items-center gap-3">
                  <img 
                    src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" 
                    alt="SOL" 
                    className="w-8 h-8 rounded-full border border-[#1cac64]/20 bg-[#d9f5cc] shrink-0"
                  />
                  <div>
                    <span className="text-xs text-[#3d6b4e] block">Solana Vault</span>
                    <span className="text-xl font-bold text-amber-600 font-mono mt-0.5 block">
                      {vaultSol !== null ? vaultSol.toFixed(4) : "0.0000"}{" "}
                      <span className="text-xs font-semibold text-[#2d5a3f]">SOL</span>
                    </span>
                  </div>
                </div>
                {vaultExists && vaultSol !== null && vaultSol > 0.0001 && (
                  <button
                    onClick={() => setActionModal({
                      type: "withdraw",
                      asset: { mint: PublicKey.default.toBase58(), isSol: true, name: "SOL", decimals: 9, maxAmount: vaultSol, image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" }
                    })}
                    className="px-3 py-1.5 text-xs font-bold bg-[#1cac64]/10 border border-[#1cac64]/20 hover:border-[#1cac64] hover:bg-[#1cac64]/20 text-[#1cac64] rounded-lg transition"
                  >
                    Withdraw ⬆
                  </button>
                )}
              </div>

              {/* SPL Tokens & NFTs */}
              <div className="space-y-2">
                <div className="flex justify-between items-center px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#2d5a3f] block">Vault SPL & NFT Assets</span>
                    {vaultNfts.length > 0 && (
                      <button
                        onClick={() => {
                          const allMintIds = vaultNfts.map(n => n.mint);
                          const allSelected = allMintIds.every(id => selectedVaultNfts.includes(id));
                          if (allSelected) {
                            setSelectedVaultNfts(prev => prev.filter(id => !allMintIds.includes(id)));
                          } else {
                            setSelectedVaultNfts(prev => Array.from(new Set([...prev, ...allMintIds])));
                          }
                        }}
                        className="text-[9px] text-[#1cac64] hover:text-[#1cac64]/80 font-semibold transition"
                      >
                        {vaultNfts.every(n => selectedVaultNfts.includes(n.mint)) ? "Deselect All NFTs" : "Select All NFTs"}
                      </button>
                    )}
                  </div>
                  {selectedVaultNfts.length > 0 && (
                    <button
                      onClick={handleBulkWithdrawNfts}
                      disabled={txLoading}
                      className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-500 text-black text-[10px] font-bold hover:from-amber-400 hover:to-yellow-400 transition cursor-pointer shadow-sm disabled:opacity-40"
                    >
                      Withdraw Selected ({selectedVaultNfts.length}) ⬆
                    </button>
                  )}
                </div>
                {vaultAssets.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#4a7d5e] border border-dashed border-[#1cac64]/20 rounded-xl">
                    No active SPL tokens or NFTs in vault.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 max-h-[220px] overflow-y-auto pr-1">
                    {vaultAssets.map((asset: any) => (
                      <div key={asset.ata} className={`p-3 rounded-xl bg-[#ffffff]/40 border border-[#1cac64]/15 flex justify-between items-center transition hover:border-[#1cac64]/30 hover:bg-[#ffffff]/60`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          {asset.isNFT && (
                            <input
                              type="checkbox"
                              checked={selectedVaultNfts.includes(asset.mint)}
                              onChange={() => handleToggleVaultNft(asset.mint)}
                              className="w-4 h-4 rounded border-[#1cac64]/20 bg-white text-[#1cac64] focus:ring-[#1cac64]/20 focus:ring-offset-0 focus:outline-none"
                            />
                          )}
                          <AssetAvatar asset={asset} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-xs text-[#0f2618] truncate">{asset.name}</span>
                              {asset.isNFT && (
                                <span className="text-[8px] px-1 py-0.2 bg-[#1cac64]/20 text-[#1cac64] border border-[#1cac64]/30 rounded font-semibold font-mono uppercase tracking-wider shrink-0">NFT</span>
                              )}
                            </div>
                            <span className="font-mono text-[9px] text-[#4a7d5e] block truncate">{asset.mint}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-bold text-[#0f2618] font-mono">{asset.uiAmount}</span>
                          {vaultExists && asset.uiAmount > 0 && (
                            <button
                              onClick={() => setActionModal({
                                type: "withdraw",
                                asset: { mint: asset.mint, isSol: false, name: asset.name, decimals: asset.decimals, maxAmount: asset.uiAmount, isNFT: asset.isNFT, image: asset.image }
                              })}
                              className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-500 text-black text-[10px] font-bold hover:from-amber-400 hover:to-yellow-400 transition cursor-pointer shadow-sm"
                            >
                              Withdraw ⬆
                            </button>
                          )}
                          {vaultExists && asset.uiAmount === 0 && (
                            <button
                              onClick={() => handleCloseVaultAta(asset.mint)}
                              disabled={txLoading}
                              className="px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 hover:border-red-500 hover:bg-red-500/20 text-red-700 text-[10px] font-bold transition disabled:opacity-50"
                              title={rentClaimMode === 1
                                ? "Close empty token account and reclaim ~0.002 SOL rent to Platform Treasury"
                                : "Close empty token account and reclaim ~0.002 SOL rent to Project Authority"
                              }
                            >
                              Close & Reclaim 🗑
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#1cac64]/15 bg-[#ebfde3]/40 flex justify-between items-center">
          <span className="text-[10px] text-[#3d6b4e]">
            Secure administrative control over {NETWORK.toLowerCase().includes("mainnet") ? "Mainnet" : "Devnet"}. CPI and Native withdrawals allowed.
          </span>
          <button 
            onClick={onClose} 
            className="px-4 py-2.5 border border-[#1cac64]/20 rounded-lg text-sm text-[#2d5a3f] hover:text-[#0f2618] hover:bg-[#d9f5cc] transition font-semibold"
          >
            Close
          </button>
        </div>
      </div>

      {/* Slide-over Action Overlay / Sleek Modal */}
      {actionModal.asset && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-panel border border-[#1cac64]/20 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150">
            <button 
              onClick={() => { setActionModal({ type: "deposit", asset: null }); setAmountStr(""); setActionErr(""); }}
              className="absolute top-4 right-4 text-[#3d6b4e] hover:text-[#0f2618] transition"
            >
              ✕
            </button>
            <h4 className="font-bold text-sm text-[#0f2618] flex items-center gap-2 capitalize">
              {actionModal.type === "deposit" ? "⬇ Deposit" : "⬆ Withdraw"}&nbsp;
              {actionModal.asset.image && (
                <img 
                  src={actionModal.asset.image} 
                  alt={actionModal.asset.name} 
                  className="w-5 h-5 rounded-full object-cover border border-[#1cac64]/20 bg-gray-50 shrink-0"
                />
              )}
              <span className="text-[#1cac64]">{actionModal.asset.name}</span>
            </h4>
            {actionModal.asset.isNFT ? (
              <div className="p-4 rounded-xl bg-[#ebfde3]/60 border border-[#1cac64]/15 text-center space-y-2 shadow-inner">
                {actionModal.asset.image ? (
                  <img 
                    src={actionModal.asset.image} 
                    alt={actionModal.asset.name} 
                    className="w-24 h-24 rounded-lg object-cover mx-auto border border-[#1cac64]/20 shadow-md"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      const fallback = document.getElementById('nft-modal-fallback');
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div 
                  id="nft-modal-fallback" 
                  className="w-12 h-12 rounded-lg bg-[#1cac64]/10 border border-[#1cac64]/20 items-center justify-center text-2xl mx-auto shadow-md animate-pulse"
                  style={{ display: actionModal.asset.image ? 'none' : 'flex' }}
                >
                  🎨
                </div>
                <div className="font-bold text-xs text-[#0f2618] pt-1">{actionModal.asset.name}</div>
                <div className="font-mono text-[9px] text-[#3d6b4e] break-all">{actionModal.asset.mint}</div>
                <div className="text-[10px] text-[#1cac64] bg-[#1cac64]/5 py-1 px-2 rounded-full inline-block font-medium border border-[#1cac64]/10">
                  Non-Fungible Token (1 Unit)
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-[#3d6b4e]">Available Max</span>
                  <span className="font-mono text-[#0f2618] font-bold">{actionModal.asset.maxAmount} {actionModal.asset.name}</span>
                </div>
                
                <div className="relative">
                  <input
                    type="number"
                    placeholder="0.0"
                    value={amountStr}
                    onChange={e => setAmountStr(e.target.value)}
                    className="w-full bg-[#ebfde3]/60 border border-[#1cac64]/15 rounded-xl px-3 py-2 text-sm text-[#0f2618] font-mono focus:outline-none focus:border-[#1cac64]/50 focus:ring-1 focus:ring-[#1cac64]/50 transition-all"
                  />
                  <button
                    onClick={() => setAmountStr(String(actionModal.asset!.maxAmount))}
                    className="absolute right-2 top-1.5 px-2 py-0.5 text-[10px] font-bold bg-[#1cac64]/10 border border-[#1cac64]/20 text-[#1cac64] rounded hover:bg-[#1cac64]/20 transition-all"
                  >
                    MAX
                  </button>
                </div>

                {/* Quick Preset Buttons */}
                <div className="grid grid-cols-4 gap-1.5">
                  {[0.25, 0.50, 0.75, 1.0].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => setAmountStr(String((actionModal.asset!.maxAmount * pct).toFixed(4)))}
                      className="py-1.5 text-[10px] bg-[#ebfde3]/60 border border-[#1cac64]/15 hover:border-[#1cac64]/40 text-[#2d5a3f] hover:text-[#0f2618] rounded-xl font-semibold transition-all"
                    >
                      {pct * 100}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-3 border-t border-[#1cac64]/15">
              <button
                onClick={() => { setActionModal({ type: "deposit", asset: null }); setAmountStr(""); setActionErr(""); }}
                className="flex-1 py-2.5 border border-[#1cac64]/20 text-[#2d5a3f] hover:text-[#0f2618] rounded-xl text-xs font-semibold hover:bg-[#c8edba] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteAction}
                disabled={txLoading || (!actionModal.asset.isNFT && (!amountStr || parseFloat(amountStr) <= 0))}
                className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-[#0f2618] hover:from-emerald-400 hover:to-teal-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-xs font-bold shadow-lg transition-all"
              >
                {txLoading ? "Processing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
