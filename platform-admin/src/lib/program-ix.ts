"use client";

import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, SendTransactionError } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import * as borsh from "borsh";
import IDL from "@/lib/idl.json";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "CXX3hFgqL5bozH8pYbTtetMHVYWkHwcx46MwHeF7VVcv"
);
export { RPC_URL };

// ── Borsh encoder (BinaryWriter) — avoids @coral-xyz/anchor encode() / Node 24 issue
// ── Imported lazily to prevent boot-time failures when this file is first loaded
function BinaryWriter(): any {
  return new borsh.BinaryWriter();
}

const ENUM_DISCRIMINANTS: Record<string, number> = {
  Sol: 0, SplToken: 1, Nft: 2,
  Active: 0, Paused: 1, Ended: 2,
};

// Known enum discriminants not in ENUM_DISCRIMINANTS (read from IDL types on demand)
const ENUM_DISCRIMINANT_MAP: Record<string, Record<string, number>> = {};

/**
 * Encode a single borsh value into a byte slice and extend `w` with those bytes.
 * `schema` is the raw IDL type entry (string | object).
 * `typeMap` is a Map<type_name, type_object> built from the IDL's `types` section.
 */
function encodeBorsh(w: any, value: any, schema: any, typeMap: Map<string, any>): void {
  if (schema === "u8") { w.writeU8(Number(value)); return; }
  if (schema === "u16") { w.writeU16(Number(value)); return; }
  if (schema === "u32") { w.writeU32(Number(value)); return; }
  if (schema === "u64") { w.writeU64(BigInt(value)); return; }
  if (schema === "i8") { w.writeBuffer(Buffer.from(new Int8Array([Math.round(value)]).buffer)); return; }
  if (schema === "i16") { w.writeBuffer(encodeI16(Number(value))); return; }
  if (schema === "i32") { w.writeBuffer(encodeI32(Number(value))); return; }
  if (schema === "i64") { w.writeBuffer(encodeI64(Number(value))); return; }
  if (schema === "bool") { w.writeBuffer(value ? Buffer.from([1]) : Buffer.from([0])); return; }

  if (typeof schema === "string") {
    if (schema === "string") { w.writeString(value); return; }
    if (schema === "pubkey" || schema === "publicKey") {
      w.writeBuffer((value && typeof value.toBuffer === "function" ? value : new PublicKey(value)).toBuffer()); return;
    }
  }

  // Option<T>
  if (Array.isArray(schema) && schema[0] === "option") {
    w.writeU8(value == null ? 0 : 1);
    if (value != null) encodeBorsh(w, value, schema[1], typeMap);
    return;
  }

  // Fixed-size array: ["type", count] or {"array":[type, count]}
  if (Array.isArray(schema) && schema[0] !== "option" && typeof schema[1] === "number") {
    const len = schema[1];
    const itemSchema = schema[2] ?? schema[0];
    for (let i = 0; i < len && i < (value?.length || 0); i++) encodeBorsh(w, value[i], itemSchema, typeMap);
    return;
  }
  if (typeof schema === "object" && schema?.array) {
    const [itemSchema, len] = schema.array;
    for (let i = 0; i < len && i < (value?.length || 0); i++) encodeBorsh(w, value[i], itemSchema, typeMap);
    return;
  }

  // Vec<T>
  if (typeof schema === "object" && schema.vec) {
    if (!Array.isArray(value)) throw new Error(`vec expected array, got ${typeof value}`);
    w.writeU32(value.length);
    for (const item of value) encodeBorsh(w, item, schema.vec, typeMap);
    return;
  }

  // Defined type  {defined: {name: "...", ...}}
  if (typeof schema === "object" && schema?.defined) {
    const defName = schema.defined.name;
    const typeDef = typeMap.get(defName);
    if (!typeDef) throw new Error(`Unknown defined type "${defName}"`);
    const inner = typeDef.type ?? typeDef;   // IDL types entry is {name, type:{kind,variants/fields}}

    // ── ENUM ──────────────────────────────────────────────────────────────────
    if (inner.kind === "enum") {
      const variants = inner.variants ?? [];
      const nameToIdx = new Map<string, number>();
      for (let i = 0; i < variants.length; i++) nameToIdx.set(variants[i].name, i);
      let discriminant: number;
      if (typeof value === "number") { discriminant = value; }
      else if (typeof value === "string") { discriminant = nameToIdx.get(value) ?? -1; }
      else discriminant = -1;
      if (discriminant < 0) throw new Error(`Unknown enum variant "${value}" for ${defName}`);
      w.writeU8(discriminant);
      return;
    }

    // ── STRUCT ────────────────────────────────────────────────────────────────
    if (inner.kind === "struct") {
      const fields = inner.fields ?? [];
      for (const f of fields) encodeBorsh(w, value?.[f.name], f.type, typeMap);
      return;
    }
  }

  throw new Error(`Unsupported borsh schema: ${JSON.stringify(schema)}`);
}

/** Build a Map<typeName, typeObject> from the IDL types section */
function buildTypeMap(IDL: any): Map<string, any> {
  const m = new Map<string, any>();
  for (const t of (IDL.types ?? [])) m.set(t.name, t);
  return m;
}

/** Encode instruction data from the IDL (avoids broken BorshInstructionCoder in Node 24) */
function _encodeArgs(name: string, args: any[]): { data: Buffer; accounts: any[] } {
  const IDL = getIdlForAnchorCoder();
  const ixDef = IDL.instructions.find((ix: any) => ix.name === name);
  if (!ixDef) throw new Error(`Unknown instruction: ${name}`);
  const typeMap = buildTypeMap(IDL);

  const w = BinaryWriter();
  for (const b of ixDef.discriminator) w.writeU8(b);
  for (let i = 0; i < args.length; i++) {
    const ixArg = ixDef.args[i];
    if (!ixArg) throw new Error(`Arg #${i} not found for ${name}: ${ixDef.args.map((a: any) => a.name)}`);
    encodeBorsh(w, args[i], ixArg.type, typeMap);
  }
  const buf = Buffer.from(w.toArray());
  return { data: buf, accounts: ixDef.accounts };
}


/** LE helpers for signed integers (borsh@0.7 BinaryWriter has no writeI* methods) */
const [Int8, Int16, Int32, Int64] = [Int8Array, Int16Array, Int32Array, BigInt64Array];

function encodeI16(v: number): Buffer {
  return Buffer.from(new Int16Array([v]).buffer);
}
function encodeI32(v: number): Buffer {
  return Buffer.from(new Int32Array([v]).buffer);
}
function encodeI64(v: number): Buffer {
  return Buffer.from(new BigInt64Array([BigInt(v)]).buffer);
}

function hasDiscriminator(raw: Buffer, name: keyof typeof ACCOUNT_DISCRIMINATORS) {
  return raw.subarray(0, 8).equals(ACCOUNT_DISCRIMINATORS[name]);
}

/** Load the local IDL snapshot for use with BorshInstructionCoder */
function getIdlForAnchorCoder(): any {
  return IDL;
}

const ACCOUNT_DISCRIMINATORS: Record<string, Buffer> = {
  PlatformConfig: Buffer.from([160, 78, 128, 0, 248, 83, 230, 160]),
  Project: Buffer.from([205, 168, 189, 202, 181, 247, 142, 19]),
  BoxConfig: Buffer.from([160, 138, 167, 132, 11, 96, 194, 19]),
  PrizeVault: Buffer.from([34, 226, 195, 160, 248, 75, 50, 7]),
  PrizeItem: Buffer.from([194, 89, 176, 118, 66, 135, 97, 67]),
  BoxReceipt: Buffer.from([168, 89, 130, 204, 214, 169, 143, 255]),
};

function readString(raw: Buffer, offset: number) {
  const length = raw.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  return { value: raw.subarray(start, end).toString("utf8"), offset: end };
}

function readU64(raw: Buffer, offset: number) {
  const low = raw.readUInt32LE(offset);
  const high = raw.readUInt32LE(offset + 4);
  const value = low + high * 0x100000000;
  return { value, offset: offset + 8 };
}

function readI64(raw: Buffer, offset: number) {
  const low = raw.readUInt32LE(offset);
  const high = raw.readInt32LE(offset + 4);
  const value = low + high * 0x100000000;
  return { value, offset: offset + 8 };
}

/** Decode a raw account buffer */
export function decodeAccount<T = any>(schema: string, raw: Buffer): T {
  if (schema === "PlatformConfig") {
    if (!hasDiscriminator(raw, "PlatformConfig")) throw new Error("Invalid PlatformConfig discriminator");
    return {
      authority: new PublicKey(raw.subarray(8, 40)).toBase58(),
      treasury: new PublicKey(raw.subarray(40, 72)).toBase58(),
      isPaused: raw[72] !== 0,
      bump: raw[73],
    } as T;
  }

  if (schema === "Project") {
    if (!hasDiscriminator(raw, "Project")) throw new Error("Invalid Project discriminator");
    let offset = 8;
    const slug = readString(raw, offset); offset = slug.offset;
    const authority = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;
    const feeWallet = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;
    const feeLamports = readU64(raw, offset); offset = feeLamports.offset;
    const isActive = raw[offset] !== 0; offset += 1;
    const bump = raw[offset]; offset += 1;
    const rentClaimMode = raw[offset]; offset += 1;
    const feeWallet2 = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;

    let name = slug.value;
    let description = "";
    let logoUri = "";
    let bgUri = "";
    let themeColor = "";

    let solRankingPointsVal = 2;
    let tokenRankingPointsVal = 1;

    if (typeof window !== "undefined" && slug.value) {
      const localBranding = localStorage.getItem(`project_branding_${slug.value}`);
      if (localBranding) {
        try {
          const parsed = JSON.parse(localBranding);
          name = parsed.name || slug.value || "";
          description = parsed.description || "";
          logoUri = parsed.logoUri || "";
          bgUri = parsed.bgUri || "";
          themeColor = parsed.themeColor || "";
          solRankingPointsVal = parsed.solRankingPoints ?? 2;
          tokenRankingPointsVal = parsed.tokenRankingPoints ?? 1;
        } catch { }
      }
    }

    return {
      slug: slug.value,
      authority,
      feeWallet,
      feeWallet2,
      feeLamports: feeLamports.value,
      isActive,
      solRankingPoints: solRankingPointsVal,
      tokenRankingPoints: tokenRankingPointsVal,
      bump,
      name,
      description,
      logoUri,
      bgUri,
      themeColor,
      rentClaimMode,
      isV2: true,
    } as T;
  }

  if (schema === "BoxConfig") {
    if (!hasDiscriminator(raw, "BoxConfig")) throw new Error("Invalid BoxConfig discriminator");
    let offset = 8;
    const project = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;
    const boxId = readU64(raw, offset); offset = boxId.offset;
    const priceLamports = readU64(raw, offset); offset = priceLamports.offset;
    const acceptedMints = Array.from({ length: 3 }, () => {
      const mint = new PublicKey(raw.subarray(offset, offset + 32));
      offset += 32;
      return mint;
    });
    const acceptedPrices = Array.from({ length: 3 }, () => {
      const price = readU64(raw, offset);
      offset = price.offset;
      return price.value;
    });
    const supply = raw.readUInt32LE(offset); offset += 4;
    const sold = raw.readUInt32LE(offset); offset += 4;
    const totalOpened = raw.readUInt32LE(offset); offset += 4;
    const totalClaimed = raw.readUInt32LE(offset); offset += 4;
    const claimedPrizes = Array.from({ length: 20 }, () => {
      const val = raw.readUInt32LE(offset);
      offset += 4;
      return val;
    });
    const startTime = readI64(raw, offset); offset = startTime.offset;
    const endTime = readI64(raw, offset); offset = endTime.offset;
    const status = raw[offset]; offset += 1;
    const bump = raw[offset]; offset += 1;
    const prizesCount = raw[offset]; offset += 1;
    return {
      project,
      boxId: boxId.value,
      priceLamports: priceLamports.value,
      acceptedMints,
      acceptedPrices,
      supply,
      sold,
      totalOpened,
      totalClaimed,
      claimedPrizes,
      startTime: startTime.value,
      endTime: endTime.value,
      status,
      bump,
      prizesCount,
    } as T;
  }

  if (schema === "PrizeVault") {
    if (!hasDiscriminator(raw, "PrizeVault")) throw new Error("Invalid PrizeVault discriminator");
    let offset = 8;
    const project = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;
    return { project, bump: raw[offset] } as T;
  }

  if (schema === "PrizeItem") {
    if (!hasDiscriminator(raw, "PrizeItem")) throw new Error("Invalid PrizeItem discriminator");
    let offset = 8;
    const boxConfig = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;
    const index = raw[offset]; offset += 1;
    const prizeType = raw[offset]; offset += 1;
    const tokenMint = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;
    const amount = { value: Number(raw.readBigUInt64LE(offset)), offset: offset + 8 }; offset = amount.offset;
    const winPercentage = raw[offset]; offset += 1;
    const totalCount = raw.readUInt32LE(offset); offset += 4;
    const claimedCount = raw.readUInt32LE(offset); offset += 4;
    return {
      boxConfig, index, prizeType, tokenMint,
      amount: amount.value, winPercentage, totalCount, claimedCount,
      bump: raw[offset],
    } as T;
  }

  if (schema === "BoxReceipt") {
    if (!hasDiscriminator(raw, "BoxReceipt")) throw new Error("Invalid BoxReceipt discriminator");
    let offset = 8;
    const user = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;
    const boxConfig = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;
    const purchased = raw.readUInt32LE(offset); offset += 4;
    const totalOpened = raw.readUInt32LE(offset); offset += 4;
    const nonce = Number(raw.readBigUInt64LE(offset)); offset += 8;
    const vecLen = raw.readUInt32LE(offset); offset += 4;
    const claimablePrizes: { prizeIndex: number; prizeType: number; tokenMint: PublicKey; amount: number }[] = [];
    for (let i = 0; i < vecLen; i++) {
      const prizeIndex = raw[offset]; offset += 1;
      const prizeType = raw[offset]; offset += 1;
      const tokenMint = new PublicKey(raw.subarray(offset, offset + 32)); offset += 32;
      const amount = Number(raw.readBigUInt64LE(offset)); offset += 8;
      claimablePrizes.push({ prizeIndex, prizeType, tokenMint, amount });
    }
    const bump = raw[offset];
    return {
      user, boxConfig, purchased, totalOpened, nonce,
      claimablePrizes, bump,
    } as T;
  }

  throw new Error(`Unknown account schema: ${schema}`);
}

export function buildIx(
  name: string,
  accounts: Record<string, { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>,
  ixArgs: any[],
  remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
): TransactionInstruction {
  const { data, accounts: accts } = _encodeArgs(name, ixArgs);
  const keys = accts.map((a: any) => {
    const entry = accounts[a.name];
    let pubkey = entry?.pubkey;
    if (!pubkey) {
      if (a.address) {
        pubkey = new PublicKey(a.address);
      } else if (a.optional) {
        pubkey = PROGRAM_ID;
      } else {
        pubkey = PublicKey.default;
      }
    }
    return {
      pubkey,
      isSigner: entry?.isSigner ?? false,
      isWritable: entry?.isWritable ?? false,
    };
  });
  if (remainingAccounts) {
    keys.push(...remainingAccounts);
  }
  return new TransactionInstruction({ programId: PROGRAM_ID, data, keys });
}

// ══════════════════════════════════════════════════════════════════════════════
// Instruction builders
// Every key below MUST match the account name in the IDL exactly (snake_case).
// IDL is the source of truth — names come from idl.json / target/idl/mystery_box.json
// ══════════════════════════════════════════════════════════════════════════════

export function ixInitializePlatform(
  platform: PublicKey,
  superAdmin: PublicKey,
  treasury: PublicKey,
): TransactionInstruction {
  return buildIx("initialize_platform", {
    platform: { pubkey: platform, isSigner: false, isWritable: true },
    super_admin: { pubkey: superAdmin, isSigner: true, isWritable: false },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [treasury]);
}

export function ixCreateProject(
  platform: PublicKey, project: PublicKey, superAdmin: PublicKey,
  slug: string, authority: PublicKey, feeWallet: PublicKey,
  feeLamports: number, solRankingPoints: number, tokenRankingPoints: number,
): TransactionInstruction {
  return buildIx("create_project", {
    platform: { pubkey: platform, isSigner: false, isWritable: true },
    project: { pubkey: project, isSigner: false, isWritable: true },
    super_admin: { pubkey: superAdmin, isSigner: true, isWritable: false },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [slug, authority, feeWallet, feeLamports, solRankingPoints, tokenRankingPoints]);
}

export function ixCreateBox(
  platform: PublicKey, project: PublicKey, boxConfig: PublicKey, tenant: PublicKey,
  slug: string, boxId: number, priceLamports: number, mints: PublicKey[], prices: number[],
  supply: number, startTime: number, endTime: number,
): TransactionInstruction {
  while (mints.length < 3) mints.push(PublicKey.default);
  while (prices.length < 3) prices.push(0);
  return buildIx("create_box", {
    platform: { pubkey: platform, isSigner: false, isWritable: false },
    project: { pubkey: project, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfig, isSigner: false, isWritable: true },
    tenant: { pubkey: tenant, isSigner: true, isWritable: false },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [slug, boxId, priceLamports, mints, prices, supply, startTime, endTime]);
}

export function ixUpdateProjectFees(
  platform: PublicKey,
  project: PublicKey,
  superAdmin: PublicKey,
  slug: string,
  newFeeWallet: PublicKey,
  newFeeLamports: number,
): TransactionInstruction {
  return buildIx("update_project_fees", {
    platform: { pubkey: platform, isSigner: false, isWritable: true },
    project: { pubkey: project, isSigner: false, isWritable: true },
    super_admin: { pubkey: superAdmin, isSigner: true, isWritable: false },
  }, [slug, newFeeWallet, newFeeLamports]);
}

// ══════════════════════════════════════════════════════════════════════════════
// sendIx  —  signs + sends + confirms in one step
// ══════════════════════════════════════════════════════════════════════════════

export async function sendIx(
  ix: TransactionInstruction,
  wallet: ReturnType<typeof useWallet>,
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  if (!wallet.signTransaction) throw new Error("Wallet not ready — signTransaction unavailable (adapter not loaded yet)");

  const conn = new Connection(RPC_URL, "confirmed");
  const tx = new Transaction().add(ix);

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await retryWithBackoff(() => conn.getLatestBlockhash(), "getLatestBlockhash(sendIx)")).blockhash;

  try {
    const signed = await wallet.signTransaction(tx as any);
    const sig = await retryWithBackoff(() => conn.sendRawTransaction(
      signed.serialize(),
      { skipPreflight: false, preflightCommitment: "confirmed" },
    ), "sendRawTransaction(sendIx)");
    await retryWithBackoff(() => conn.confirmTransaction(sig, "confirmed"), "confirmTransaction(sendIx)");
    return sig;
  } catch (err) {
    if (err instanceof SendTransactionError) {
      try {
        const logs = await err.getLogs(conn);
        Object.defineProperty(err, "logs", { value: logs, configurable: true, writable: true });
      } catch (logErr) {
        console.error("Failed to retrieve SendTransactionError logs in sendIx:", logErr);
      }
    }
    throw err;
  }
}

export async function sendTx(
  tx: Transaction,
  wallet: ReturnType<typeof useWallet>,
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  if (!wallet.signTransaction) throw new Error("Wallet not ready — signTransaction unavailable");

  const conn = new Connection(RPC_URL, "confirmed");

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await retryWithBackoff(() => conn.getLatestBlockhash(), "getLatestBlockhash(sendTx)")).blockhash;

  try {
    const signed = await wallet.signTransaction(tx as any);
    const sig = await retryWithBackoff(() => conn.sendRawTransaction(
      signed.serialize(),
      { skipPreflight: false, preflightCommitment: "confirmed" },
    ), "sendRawTransaction(sendTx)");
    await retryWithBackoff(() => conn.confirmTransaction(sig, "confirmed"), "confirmTransaction(sendTx)");
    return sig;
  } catch (err) {
    if (err instanceof SendTransactionError) {
      try {
        const logs = await err.getLogs(conn);
        Object.defineProperty(err, "logs", { value: logs, configurable: true, writable: true });
      } catch (logErr) {
        console.error("Failed to retrieve SendTransactionError logs in sendTx:", logErr);
      }
    }
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PDA helpers
// ══════════════════════════════════════════════════════════════════════════════

export async function platformPDA() {
  return PublicKey.findProgramAddressSync([Buffer.from("platform")], PROGRAM_ID);
}

export async function projectPDA(slug: string) {
  return PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], PROGRAM_ID);
}

export async function boxPDA(project: PublicKey, boxId: bigint | number) {
  const buf = typeof boxId === "bigint"
    ? Buffer.from(new Uint8Array(new BigUint64Array([boxId]).buffer))
    : Buffer.from(new Uint8Array(new BigUint64Array([BigInt(boxId)]).buffer));
  return PublicKey.findProgramAddressSync([Buffer.from("box"), project.toBuffer(), buf], PROGRAM_ID);
}

export async function vaultPDA(project: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), project.toBuffer()], PROGRAM_ID);
}

export { boxPDA as pdaBox };

export function buildConn() {
  return new Connection(RPC_URL, "confirmed");
}

/* Retry-with-backoff for RPC calls (avoids 429 rate-limits) */

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1_000;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit")) return true;
    const name = (err as any).constructor?.name ?? "";
    if (name === "MaxRetriesExceededError") return true;
    if ((err as any).status === 429 || (err as any).statusCode === 429) return true;
  }
  return false;
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, label = ""): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES - 1) break;
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
      console.warn(`[retry] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed – waiting ${Math.round(delay)}ms:`, (err as Error).message);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Fetch all Project accounts by discriminator scan */
export async function fetchProjects(): Promise<{ pubkey: string; name: string; slug: string; description: string; isActive: boolean; logoUri?: string; bgUri?: string; themeColor?: string; rentClaimMode?: number; solRankingPoints?: number; tokenRankingPoints?: number; feeWallet2?: string; feeWallet?: string; feeLamports?: number }[]> {
  const conn = buildConn();
  const result: any[] = [];
  const accounts = await retryWithBackoff(() => conn.getProgramAccounts(PROGRAM_ID), "getProgramAccounts(fetchProjects)");
  for (const { pubkey, account } of accounts) {
    try {
      const d = decodeAccount<any>("Project", account.data);
      let name = d.name || d.slug || "";
      let description = d.description || "";
      let logoUri = d.logoUri || "";
      let bgUri = d.bgUri || "";
      let themeColor = d.themeColor || "";

      if (typeof window !== "undefined" && d.slug) {
        const localBranding = localStorage.getItem(`project_branding_${d.slug}`);
        if (localBranding) {
          try {
            const parsed = JSON.parse(localBranding);
            name = name || parsed.name || d.slug || "";
            description = description || parsed.description || "";
            logoUri = logoUri || parsed.logoUri || "";
            bgUri = bgUri || parsed.bgUri || "";
            themeColor = themeColor || parsed.themeColor || "";
          } catch { }
        }
      }

      result.push({
        pubkey: pubkey.toBase58(),
        name,
        slug: d.slug ?? "",
        description,
        logoUri,
        bgUri,
        themeColor,
        isActive: d.isActive ?? true,
        rentClaimMode: d.rentClaimMode ?? 0,
        solRankingPoints: d.solRankingPoints,
        tokenRankingPoints: d.tokenRankingPoints,
        feeWallet: d.feeWallet?.toBase58?.() || String(d.feeWallet),
        feeLamports: d.feeLamports ? Number(d.feeLamports) : 0,
        feeWallet2: d.feeWallet2?.toBase58?.() || String(d.feeWallet2),
      });
    } catch { /* not Project */ }
  }
  return result;
}

export async function fetchBoxesForProject(projectPk: PublicKey): Promise<any[]> {
  const conn = buildConn();
  const result: any[] = [];
  const accounts = await retryWithBackoff(() => conn.getProgramAccounts(PROGRAM_ID), "getProgramAccounts(fetchBoxesForProject)");
  for (const { pubkey, account } of accounts) {
    try {
      const b = decodeAccount<any>("BoxConfig", account.data);
      if (b.project.equals(projectPk)) result.push({ ...b, pubkey: pubkey.toBase58() });
    } catch { /* not BoxConfig */ }
  }
  return result;
}

export async function fetchAllBoxes(): Promise<any[]> {
  const conn = buildConn();
  const result: any[] = [];
  const accounts = await retryWithBackoff(() => conn.getProgramAccounts(PROGRAM_ID), "getProgramAccounts(fetchAllBoxes)");
  for (const { pubkey, account } of accounts) {
    try {
      const b = decodeAccount<any>("BoxConfig", account.data);
      result.push({ ...b, pubkey: pubkey.toBase58() });
    } catch { /* not BoxConfig */ }
  }
  return result;
}

export async function fetchAllPrizeItems(): Promise<any[]> {
  const conn = buildConn();
  const result: any[] = [];
  const accounts = await retryWithBackoff(() => conn.getProgramAccounts(PROGRAM_ID), "getProgramAccounts(fetchAllPrizeItems)");
  for (const { pubkey, account } of accounts) {
    try {
      const p = decodeAccount<any>("PrizeItem", account.data);
      result.push({ ...p, pubkey: pubkey.toBase58(), lamports: account.lamports });
    } catch { /* not PrizeItem */ }
  }
  return result;
}

/** Fetch lamports for a list of pubkeys (returns Map<base58, lamports>) */
export async function fetchAccountLamports(pubkeys: PublicKey[]): Promise<Map<string, number>> {
  const conn = buildConn();
  const result = new Map<string, number>();
  // Batch in chunks of 100 to stay within getMultipleAccountsInfo limits
  const chunkSize = 100;
  for (let i = 0; i < pubkeys.length; i += chunkSize) {
    const chunk = pubkeys.slice(i, i + chunkSize);
    const accounts = await retryWithBackoff(
      () => conn.getMultipleAccountsInfo(chunk),
      `getMultipleAccountsInfo(batch-${i})`
    );
    for (let j = 0; j < chunk.length; j++) {
      if (accounts[j]) {
        result.set(chunk[j].toBase58(), accounts[j]!.lamports);
      }
    }
  }
  return result;
}

export async function decodeBox(raw: Buffer, pk: PublicKey) {
  return { ...decodeAccount<any>("BoxConfig", raw), pubkey: pk.toBase58() };
}

export type BoxStatusCode = 0 | 1 | 2;

/** Anchor decodes BoxStatus as 0|1|2 or `{ active: {} }` — normalize for UI. */
export function boxStatusToCode(status: unknown): BoxStatusCode {
  if (typeof status === "number" && status >= 0 && status <= 2) return status as BoxStatusCode;
  if (status && typeof status === "object") {
    if ("active" in status) return 0;
    if ("paused" in status) return 1;
    if ("ended" in status) return 2;
  }
  return 0;
}

/** BN / bigint / snake_case field → unix seconds. */
export function toUnixSeconds(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      if (Number.isFinite(n)) return Math.floor(n);
    } catch { /* ignore oversized BN */ }
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

/** Format unix seconds for `<input type="datetime-local" />` (local timezone). */
export function unixToDatetimeLocal(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse datetime-local input value to unix seconds (local timezone). */
export function datetimeLocalToUnix(value: string): number {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.floor(ms / 1000);
}

export function getSolanaErrorDetails(err: any): string {
  if (!err) return "Unknown error";

  if (err instanceof SendTransactionError) {
    console.error("[SendTransactionError] Detailed Logs:", err.logs);
  } else if (err && typeof err.getLogs === "function") {
    try {
      console.error("[Solana Error] Detailed Logs:", err.logs || err.getLogs());
    } catch { }
  }

  let msg = err.detail?.message || err.message || String(err);

  // Clean up user rejection/cancellation messages
  if (
    msg.includes("User rejected the request") ||
    msg.includes("rejected") ||
    err.name === "WalletSignTransactionError" ||
    msg.includes("WalletSignTransactionError")
  ) {
    return "Transaction cancelled by user.";
  }

  // Clean up disconnected port errors
  if (
    msg.includes("disconnected port") ||
    msg.includes("disconnected") ||
    msg.includes("Disconnected")
  ) {
    return "Wallet connection lost. Please reload the page or reconnect your wallet.";
  }

  let logs: string[] = [];
  if (Array.isArray(err.logs)) {
    logs = err.logs;
  } else if (typeof err.getLogs === "function") {
    try {
      logs = err.getLogs();
    } catch { }
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

  if (msg.includes("insufficient funds for rent") || msg.includes("insufficient balance for rent")) {
    return "Insufficient SOL balance for rent-exempt minimum of new accounts.";
  }

  if (logs && logs.length > 0) {
    msg += "\nLogs:\n" + logs.map((l: string) => `  ${l}`).join("\n");
  }

  return msg;
}

export function ixCloseBox(
  platform: PublicKey,
  project: PublicKey,
  boxConfig: PublicKey,
  signer: PublicKey,
  platformTreasury: PublicKey,
  slug: string,
  boxId: number,
): TransactionInstruction {
  return buildIx("close_box", {
    platform: { pubkey: platform, isSigner: false, isWritable: false },
    project: { pubkey: project, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfig, isSigner: false, isWritable: true },
    signer: { pubkey: signer, isSigner: true, isWritable: false },
    platform_treasury: { pubkey: platformTreasury, isSigner: false, isWritable: true },
  }, [slug, boxId]);
}



export function ixCloseProject(
  platform: PublicKey,
  project: PublicKey,
  superAdmin: PublicKey,
  slug: string,
): TransactionInstruction {
  return buildIx("close_project", {
    platform: { pubkey: platform, isSigner: false, isWritable: false },
    project: { pubkey: project, isSigner: false, isWritable: true },
    super_admin: { pubkey: superAdmin, isSigner: true, isWritable: true },
  }, [slug]);
}

export function ixOpenBox(
  platform: PublicKey,
  project: PublicKey,
  boxConfig: PublicKey,
  receipt: PublicKey,
  vault: PublicKey,
  user: PublicKey,
  feeWallet: PublicKey,
  tenantWallet: PublicKey,
  slug: string,
  boxId: number,
  quantity: number,
  remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
): TransactionInstruction {
  return buildIx("open_box", {
    platform: { pubkey: platform, isSigner: false, isWritable: false },
    project: { pubkey: project, isSigner: false, isWritable: false },
    box_config: { pubkey: boxConfig, isSigner: false, isWritable: true },
    receipt: { pubkey: receipt, isSigner: false, isWritable: true },
    vault: { pubkey: vault, isSigner: false, isWritable: true },
    user: { pubkey: user, isSigner: true, isWritable: true },
    fee_wallet: { pubkey: feeWallet, isSigner: false, isWritable: true },
    tenant_wallet: { pubkey: tenantWallet, isSigner: false, isWritable: true },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    slot_hashes: { pubkey: new PublicKey("SysvarS1otHashes111111111111111111111111111"), isSigner: false, isWritable: false },
    instructions: { pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"), isSigner: false, isWritable: false },
  }, [slug, boxId, quantity], remainingAccounts);
}

export function ixClaimPrizes(
  platform: PublicKey,
  project: PublicKey,
  receipt: PublicKey,
  vault: PublicKey,
  user: PublicKey,
  slug: string,
  remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]
): TransactionInstruction {
  return buildIx("claim_prizes", {
    platform: { pubkey: platform, isSigner: false, isWritable: false },
    project: { pubkey: project, isSigner: false, isWritable: false },
    receipt: { pubkey: receipt, isSigner: false, isWritable: true },
    vault: { pubkey: vault, isSigner: false, isWritable: true },
    user: { pubkey: user, isSigner: true, isWritable: true },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    token_program: { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
  }, [slug], remainingAccounts);
}

export function ixCloseReceipt(
  platform: PublicKey,
  project: PublicKey,
  receipt: PublicKey,
  user: PublicKey,
  platformTreasury: PublicKey,
  slug: string,
): TransactionInstruction {
  return buildIx("close_receipt", {
    platform: { pubkey: platform, isSigner: false, isWritable: false },
    project: { pubkey: project, isSigner: false, isWritable: false },
    receipt: { pubkey: receipt, isSigner: false, isWritable: true },
    user: { pubkey: user, isSigner: true, isWritable: true },
    platform_treasury: { pubkey: platformTreasury, isSigner: false, isWritable: true },
    system_program: { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  }, [slug]);
}

export function ixCloseVaultTokenAccount(
  platform: PublicKey,
  project: PublicKey,
  vault: PublicKey,
  vaultTokenAccount: PublicKey,
  platformTreasury: PublicKey,
  signer: PublicKey,
  slug: string,
): TransactionInstruction {
  return buildIx("close_vault_token_account", {
    platform: { pubkey: platform, isSigner: false, isWritable: false },
    project: { pubkey: project, isSigner: false, isWritable: false },
    vault: { pubkey: vault, isSigner: false, isWritable: false },
    vault_token_account: { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    platform_treasury: { pubkey: platformTreasury, isSigner: false, isWritable: true },
    signer: { pubkey: signer, isSigner: true, isWritable: true },
    token_program: { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
  }, [slug]);
}


