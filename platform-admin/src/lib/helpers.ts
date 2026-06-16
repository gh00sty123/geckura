"use client";

import { useEffect, useMemo, useState } from "react";
import { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, Transaction, TransactionInstruction, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./solana";
import IDL from "@/lib/idl.json";
import { BorshInstructionCoder, BorshAccountsCoder } from "@coral-xyz/anchor";

/* ── Retry-with-backoff for RPC calls ─────────────────── */

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1_000;

async function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

export async function retryWithBackoffH<T>(fn: () => Promise<T>, label = ""): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_RETRIES - 1) break;
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
      console.warn(`[retry] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed – waiting ${Math.round(delay)}ms:`, (err as Error).message);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ─── Account schemas by name (Borsh string keys from IDL) ───────────────────

export const SCHEMAS: Record<string, string> = {
  PlatformConfig: "PlatformConfig",
  Project:        "Project",
  BoxConfig:      "BoxConfig",
  PrizeVault:     "PrizeVault",
  PrizeItem:      "PrizeItem",
  BoxReceipt:     "BoxReceipt",
};

// ─── Public-key fetchers (behave as hooks so only call inside components) ─────

export function usePlatformAddress() {
  return useMemo(() => PublicKey.findProgramAddressSync([Buffer.from("platform")], PROGRAM_ID), []);
}

export function useProjectAddress(slug: string) {
  return useMemo(() => PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(slug)], PROGRAM_ID), [slug]);
}

export function useBoxAddress(project: PublicKey, boxId: number | bigint) {
  return useMemo(() => {
    const id = typeof boxId === "bigint" ? boxId : BigInt(boxId);
    return PublicKey.findProgramAddressSync([Buffer.from("box"), project.toBuffer(), Buffer.from(new Uint8Array(new BigUint64Array([id]).buffer))], PROGRAM_ID);
  }, [project, boxId]);
}

export function useVaultAddress(project: PublicKey) {
  return useMemo(() => PublicKey.findProgramAddressSync([Buffer.from("vault"), project.toBuffer()], PROGRAM_ID), [project]);
}

export function useReceiptAddress(user: PublicKey, boxCfg: PublicKey) {
  return useMemo(() => PublicKey.findProgramAddressSync([Buffer.from("receipt"), user.toBuffer(), boxCfg.toBuffer()], PROGRAM_ID), [user, boxCfg]);
}

// ─── Build a simple Anchor instruction from the IDL using Borsh coder ─────────

function coder() {
  return { instruction: new BorshInstructionCoder(IDL as any) as any, accounts: new BorshAccountsCoder(IDL as any) as any };
}

export function buildIx(name: string, accounts: Record<string, PublicKey>, args: any[]): TransactionInstruction {
  const { instruction } = coder();
  // BorshAccountsCoder for account name → pubkey mapping
  const ixJson = (instructionsJson() as any[]).find((ix: any) => ix.name === name);
  if (!ixJson) throw new Error(`Unknown instruction: ${name}`);
  const ix = instruction.encode(ixJson, Object.entries(accounts).map(([k, v]) => ({ name: k, pubkey: v, isWritable: false, isSigner: false })), args);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: ix.data,
    keys: ix.accounts.map((a: any) => ({ pubkey: a.pubkey, isSigner: a.isSigner, isWritable: a.isWritable })),
  });
}

export function decodeAccount(name: string, raw: Buffer) {
  const borsh = (coder() as any).accounts;
  return borsh.decode(name, Buffer.from(raw));
}

function instructionsJson() {
  return (IDL as any).instructions;
}

// ─── Send a transaction ────────────────────────────────────────────────────

export async function send(ix: TransactionInstruction, wallet: WalletContextState): Promise<string> {
  if (!wallet.publicKey) throw new Error("Connect wallet first");
  if (!wallet.signTransaction) throw new Error("Wallet does not support transaction signing");
  const conn = new Connection(
    process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
    "confirmed"
  );
  const tx = new Transaction().add(ix);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await retryWithBackoffH(() => conn.getLatestBlockhash(), "getLatestBlockhash(send-helper)")).blockhash;
  const signed = await wallet.signTransaction(tx as any);
  const sig = await retryWithBackoffH(() => conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" }), "sendRawTransaction(helper)");
  await retryWithBackoffH(() => conn.confirmTransaction(sig, "confirmed"), "confirmTransaction(helper)");
  return sig;
}

export function resolveIpfsUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("ipfs://")) {
    const path = trimmed.slice(7);
    if (path.startsWith("ipfs/")) {
      return `https://ipfs.io/${path}`;
    }
    return `https://ipfs.io/ipfs/${path}`;
  }
  return trimmed;
}
