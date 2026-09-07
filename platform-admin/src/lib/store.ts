"use client";

import { create } from "zustand";
import { retryWithBackoff, fetchProjects, buildIx, boxStatusToCode, toUnixSeconds, platformPDA, projectPDA, boxPDA } from "@/lib/program-ix";
import { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, SystemProgram, Transaction, SendTransactionError } from "@solana/web3.js";
import toast from "react-hot-toast";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import IDL from "@/lib/idl.json";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";

function parseSolanaError(err: any): string {
  if (err instanceof SendTransactionError) {
    console.error("[SendTransactionError] Detailed Logs:", err.logs);
  } else if (err && typeof err.getLogs === "function") {
    try {
      console.error("[Solana Error] Detailed Logs:", err.logs || (err as any).getLogs?.());
    } catch {}
  }

  const msg = err?.message || "";
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
    msg.includes("BlockhashNotFound")
  ) {
    return "Transaction expired while waiting for wallet confirmation. Please try again and approve the wallet prompt quickly.";
  }

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
  if (msg.includes("Attempt to debit an account but found no record of a prior credit")) {
    return "Insufficient SOL balance to pay for transaction fees or box price.";
  }
  if (msg.includes("insufficient funds for rent") || msg.includes("insufficient balance for rent")) {
    return "Insufficient SOL balance for rent-exempt minimum of new accounts.";
  }

  return msg || "Transaction failed. Please try again.";
}

/* ────────────────────────────────────────────────────
   Contract data types (mirrors on-chain BoxConfig)
   ──────────────────────────────────────────────────── */
export type BoxStatus = 0 | 1 | 2; // Active | Paused | Ended

export interface LiveBox {
  pubkey: string;
  boxId: number;
  project: string;
  name: string;
  description: string;
  priceLamports: number;
  bannerUri: string | null;
  acceptedMints: string[];
  acceptedPrices: number[];
  supply: number;
  sold: number;
  startTime: number;
  endTime: number;
  status: BoxStatus;
}

export interface Notification {
  id: string;
  type: "win" | "new_pack" | "daily_reward";
  message: string;
  timestamp: number;
  read: boolean;
}

/* ────────────────────────────────────────────────────
   Store — UI state only, no mock data
   ──────────────────────────────────────────────────── */
export interface AppUIState {
  // Data (read from chain)
  boxes: LiveBox[];
  allProjects: Array<{ pubkey: string; name: string; slug: string; isActive: boolean }>;
  isLoadingBoxes: boolean;
  lastRefreshed: number | null;

  // User
  solBalance: number;
  walletAddress: string | null;

  // Notifications
  notifications: Notification[];

  // UI state
  categoryFilter: "all" | "limited" | "community" | "seasonal" | "legendary_vault";
  drawRarityFilter: string;

  // Pack opening
  isOpening: boolean;
  openingBoxName: string;
  openingReward: { name: string; rarity: string; image: string } | null;

  // Actions
  refetch: () => Promise<void>;
  setCategoryFilter: (f: AppUIState["categoryFilter"]) => void;
  setDrawRarityFilter: (f: string) => void;
  openBox: (boxName: string) => void;
  closeBoxPanel: () => void;
  claimReward: () => void;
  buyBoxNow: (box: LiveBox, wallet: WalletContextState) => Promise<void>;
  openBoxNow:   (box: LiveBox, wallet: WalletContextState) => Promise<void>;
  refreshBalance: (wallet: WalletContextState) => Promise<void>;
  addNotification: (notification: Omit<Notification, "id" | "read">) => void;
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;
}

const GECKURA_DEFAULT_SLUG = "geckurabox";
const RPC =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

/** Lazy RPC connection — avoids deps at module eval time */
function makeConn(): Connection {
  return new Connection(RPC, "confirmed");
}

/** Latest blockhash — wraps retryWithBackoff so TS inference quirk is scoped here */
async function latestBlockhash(conn: Connection): Promise<{ blockhash: string }> {
  return (await retryWithBackoff(
    () => conn.getLatestBlockhash("confirmed"), "getLatestBlockhash",
  )) as unknown as { blockhash: string };
}

function getGeckuraProjectPk(projects: AppUIState["allProjects"]): string {
  if (projects && projects.length > 0) {
    const found = projects.find(p => p.slug === GECKURA_DEFAULT_SLUG);
    if (found) return found.pubkey;
  }
  let hash = 0;
  for (let i = 0; i < GECKURA_DEFAULT_SLUG.length; i++) {
    hash = (hash << 5) - hash + GECKURA_DEFAULT_SLUG.charCodeAt(i);
    hash |= 0;
  }
  const pId = Math.abs(hash) || 1;
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(pId), true);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("project"), Buffer.from(buf)],
    new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "5GA4F3dUw4uZc63UFRQxcyqZBA1TMvDG9p9XzAVCojwD"),
  )[0].toBase58();
}

export const useAppStore = create<AppUIState>((set, get) => ({
  boxes: [],
  allProjects: [],
  isLoadingBoxes: false,
  lastRefreshed: null,
  solBalance: 0,
  walletAddress: null,
  notifications: [],

  categoryFilter:    "all",
  drawRarityFilter:  "all",

  isOpening: false,
  openingBoxName: "",
  openingReward: null,

  /* ── Fetch all boxes for the default Geckura project ── */
  refetch: async () => {
    set({ isLoadingBoxes: true });
    const conn = makeConn();
    try {
      const allPkgs = await retryWithBackoff(
        () => conn.getProgramAccounts(new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "5GA4F3dUw4uZc63UFRQxcyqZBA1TMvDG9p9XzAVCojwD")),
        "getProgramAccounts(frontend)",
      );
      const projects = await fetchProjects();
      set({ allProjects: projects });

      const coder = new BorshAccountsCoder(IDL as any);

      const GECKURA_PROJECT_PK = getGeckuraProjectPk(projects);

      const result: LiveBox[] = [];
      for (const { pubkey, account } of allPkgs as unknown as { pubkey: PublicKey; account: { data: Buffer } }[]) {
        try {
          const b: any = coder.decode("BoxConfig", account.data);
          if (b.project.toBase58() === GECKURA_PROJECT_PK || b.project.equals(new PublicKey(GECKURA_PROJECT_PK))) {
            const boxId = b.boxId?.toNumber?.()    ?? b.boxId ?? b.box_id?.toNumber?.() ?? b.box_id ?? 0;
            let boxName = `Box #${boxId}`;
            let boxDesc = "Mystery box from the Geckura ecosystem.";
            let boxBanner = null;
            if (typeof window !== "undefined") {
              const localBox = localStorage.getItem(`box_branding_geckurabox_${boxId}`);
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
              project:    b.project.toBase58(),
              name:       boxName,
              description: boxDesc,
              priceLamports: b.priceLamports?.toNumber?.() ?? b.priceLamports ?? b.price_lamports?.toNumber?.() ?? b.price_lamports ?? 0,
              bannerUri:  boxBanner,
              acceptedMints: b.acceptedMints?.map?.((m: any) => m.toBase58()) ?? b.accepted_mints?.map?.((m: any) => m.toBase58()) ?? [],
              acceptedPrices: b.acceptedPrices?.map?.((p: any) => p.toNumber?.() ?? p) ?? b.accepted_prices?.map?.((p: any) => p.toNumber?.() ?? p) ?? [],
              supply:   b.supply?.toNumber?.()  ?? b.supply ?? 0,
              sold:     b.sold?.toNumber?.()    ?? b.sold ?? 0,
              startTime: toUnixSeconds(b.startTime ?? b.start_time),
              endTime:   toUnixSeconds(b.endTime ?? b.end_time),
              status:   boxStatusToCode(b.status),
            } as LiveBox);
          }
        } catch { /* skip non-BoxConfig accounts */ }
      }
      set({ boxes: result, isLoadingBoxes: false, lastRefreshed: Date.now() });
    } catch (e) {
      console.error("[AppStore] refetch failed:", e);
      set({ boxes: [], isLoadingBoxes: false, lastRefreshed: Date.now() });
    }
  },

  setCategoryFilter: (f) => set({ categoryFilter: f }),
  setDrawRarityFilter: (f) => set({ drawRarityFilter: f }),

  openBox: (name)       => set({ isOpening: true, openingBoxName: name }),
  closeBoxPanel: ()     => set({ isOpening: false, openingBoxName: "", openingReward: null }),
  claimReward: ()       => set({ isOpening: false, openingBoxName: "", openingReward: null }),

  /* ── Buy a mystery box ── */
  buyBoxNow: async (box: LiveBox, wallet: WalletContextState) => {
    if (!wallet.publicKey) { toast.error("Connect wallet first"); return; }
    toast.loading("Purchasing box…", { id: "buy-box" });
    const conn = makeConn();
    try {
      const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "5GA4F3dUw4uZc63UFRQxcyqZBA1TMvDG9p9XzAVCojwD");
      const projectPk = new PublicKey(box.project);
      const receiptPk = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), wallet.publicKey.toBuffer(), projectPk.toBuffer()],
        PGID,
      )[0];
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

      /* Derive correct PDAs for platform, project, and box_config accounts */
      const projectObj = get().allProjects.find(p => p.pubkey === box.project);
      const slug = projectObj ? projectObj.slug : "geckurabox";

      const [platformPubkey] = await platformPDA();
      const [projectPubkey] = await projectPDA(slug);
      const [boxConfigPubkey] = await boxPDA(projectPubkey, BigInt(box.boxId));

      const ix = buildIx("open_box", {
        platform:      { pubkey: platformPubkey,             isSigner: false, isWritable: true  },
        project:       { pubkey: projectPubkey,              isSigner: false, isWritable: false },
        box_config:    { pubkey: boxConfigPubkey,            isSigner: false, isWritable: true  },
        receipt:       { pubkey: receiptPk,                  isSigner: false, isWritable: true  },
        user:          { pubkey: wallet.publicKey,           isSigner: true,  isWritable: false },
        fee_wallet:    { pubkey: feeWalletPk,                isSigner: false, isWritable: true  },
        tenant_wallet: { pubkey: tenantPk,                   isSigner: false, isWritable: true  },
        system_program: { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
      }, [slug, box.boxId, 1]);

      const tx = new Transaction().add(ix);
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await latestBlockhash(conn)).blockhash;
      const signed = await (wallet as any)?.signTransaction?.(tx as any) ?? tx;
      const sig = await retryWithBackoff(
        () => conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" }),
        "sendRawTransaction(buy)",
      );
      await retryWithBackoff(
        () => conn.confirmTransaction(sig, "confirmed"),
        "confirmTransaction(buy)",
      );
      toast.success("Box purchased!", { id: "buy-box" });
      get().refetch();
    } catch (e: any) {
      if (e instanceof SendTransactionError) {
        try {
          const logs = await e.getLogs(conn);
          Object.defineProperty(e, "logs", { value: logs, configurable: true, writable: true });
        } catch (logErr) {
          console.error("Failed to retrieve SendTransactionError logs in buyBoxNow:", logErr);
        }
      }
      toast.error(parseSolanaError(e), { id: "buy-box" });
    }
  },

  /* ── Open a mystery box ── */
  openBoxNow: async (box: LiveBox, wallet: WalletContextState) => {
    if (!wallet.publicKey) { toast.error("Connect wallet first"); return; }
    toast.loading("Opening box…", { id: "open-box" });
    const conn = makeConn();
    try {
      const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "5GA4F3dUw4uZc63UFRQxcyqZBA1TMvDG9p9XzAVCojwD");
      const projectPk = new PublicKey(box.project);
      const receiptPk  = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), wallet.publicKey.toBuffer(), projectPk.toBuffer()],
        PGID,
      )[0];
      const vaultPk    = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), new PublicKey(box.project).toBuffer()],
        PGID,
      )[0];

      /* Derive correct PDAs for platform, project, and box_config */
      const projectObj = get().allProjects.find(p => p.pubkey === box.project);
      const slug = projectObj ? projectObj.slug : "geckurabox";

      const [platformPubkey] = await platformPDA();
      const [projectPubkey] = await projectPDA(slug);
      const [boxConfigPubkey] = await boxPDA(projectPubkey, BigInt(box.boxId));

      const allPkgs = await retryWithBackoff(() => conn.getProgramAccounts(PGID), "getProgramAccounts(openBoxStore)");
      const accountCoder = new BorshAccountsCoder(IDL as any);

      const prizeItemAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
      const prizeItems: any[] = [];
      for (const { pubkey, account } of allPkgs) {
        try {
          const p = accountCoder.decode("PrizeItem", account.data);
          const boxPk = p.boxConfig ?? p.box_config;
          if (boxPk && boxPk.equals(boxConfigPubkey)) {
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

            const tmRaw = p.tokenMint ?? p.token_mint;
            const tokenMintStr = tmRaw?.toBase58?.() || String(tmRaw);

            prizeItems.push({
              prize_type,
              token_mint: tokenMintStr,
            });

            prizeItemAccounts.push({
              pubkey,
              isSigner: false,
              isWritable: true,
            });
          }
        } catch {}
      }

      const tx = new Transaction();

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
          console.log(`[StoreOpenBox] User ATA for ${mintStr.slice(0, 8)}… does not exist, creating one...`);
          tx.add(createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            userAta,
            wallet.publicKey,
            mint
          ));
        }
      }

      // Use first prize mint for the required optional accounts
      const selectedMintStr = uniquePrizeMints[0];
      let vaultTokenAccount: PublicKey | undefined;
      let userTokenAccount: PublicKey | undefined;
      if (selectedMintStr) {
        const mint = new PublicKey(selectedMintStr);
        vaultTokenAccount = getAssociatedTokenAddressSync(mint, vaultPk, true);
        userTokenAccount = getAssociatedTokenAddressSync(mint, wallet.publicKey);
      }

      // Filter PrizeItem remaining accounts: only include SOL prizes + prizes matching the selected mint
      // The on-chain code deserializes ALL remaining accounts as PrizeItem, so we can't include ATAs here.
      // Only passing compatible prizes prevents InvalidMint errors when the random roll picks a prize.
      const filteredPrizeAccounts = selectedMintStr
        ? prizeItemAccounts.filter((_, idx) => {
            const prize = prizeItems[idx];
            if (!prize) return true;
            if (prize.prize_type === "Sol") return true;
            return prize.token_mint === selectedMintStr;
          })
        : prizeItemAccounts;

      const ix = buildIx("request_open", {
        platform:       { pubkey: platformPubkey,             isSigner: false, isWritable: false },
        project:        { pubkey: projectPubkey,              isSigner: false, isWritable: false },
        box_config:     { pubkey: boxConfigPubkey,            isSigner: false, isWritable: false },
        receipt:        { pubkey: receiptPk,                  isSigner: false, isWritable: true  },
        user:           { pubkey: wallet.publicKey,           isSigner: true,  isWritable: false },
        system_program: { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
      }, [slug, Number(box.boxId), 1]);

      tx.add(ix);
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await latestBlockhash(conn)).blockhash;
      const signed = await (wallet as any)?.signTransaction?.(tx as any) ?? tx;
      const sig = await retryWithBackoff(
        () => conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" }),
        "sendRawTransaction(open)",
      );
      await retryWithBackoff(
        () => conn.confirmTransaction(sig, "confirmed"),
        "confirmTransaction(open)",
      );
      toast.success("Open request submitted! Awaiting automatic reveal...", { id: "open-box" });
      get().refetch();
    } catch (e: any) {
      if (e instanceof SendTransactionError) {
        try {
          const logs = await e.getLogs(conn);
          Object.defineProperty(e, "logs", { value: logs, configurable: true, writable: true });
        } catch (logErr) {
          console.error("Failed to retrieve SendTransactionError logs in openBoxNow:", logErr);
        }
      }
      toast.error(parseSolanaError(e), { id: "open-box" });
    }
  },

  /* ── Refresh wallet balance ── */
  refreshBalance: async (wallet: WalletContextState) => {
    if (!wallet.publicKey) return;
    try {
      const conn = makeConn();
      const lamports = await conn.getBalance(wallet.publicKey);
      set({ solBalance: lamports / 1e9, walletAddress: wallet.publicKey.toBase58() });
    } catch { /* already connected */ }
  },

  /* ── Notifications ── */
  addNotification: (notification) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      read: false,
    };
    set((state) => ({ notifications: [newNotification, ...state.notifications] }));
  },

  markNotificationRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }));
  },

  clearAllNotifications: () => {
    set({ notifications: [] });
  },
}));

/* Legacy type alias for components still using the old AppState name */
export type AppState = AppUIState;