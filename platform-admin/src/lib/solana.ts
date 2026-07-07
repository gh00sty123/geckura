"use client";

import { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodeAccount as decodeRawAccount } from "@/lib/program-ix";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "CXX3hFgqL5bozH8pYbTtetMHVYWkHwcx46MwHeF7VVcv"
);
export const SYS = PublicKey.default;

function getConn() { return new Connection(RPC_URL, "confirmed"); }

export function useAccount<T>(pubkey: PublicKey | null, schema: any): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    if (!pubkey) return;
    getConn().getAccountInfo(pubkey).then(info => {
      if (!info) { setData(null); return; }
      try {
        setData(decodeRawAccount<T>(schema as string, info.data));
      } catch { setData(null); }
    }).catch(() => setData(null));
  }, [pubkey, schema]);
  return data;
}

export async function fetchAccount<T>(pubkey: PublicKey, schema: string): Promise<T | null> {
  try {
    const info = await getConn().getAccountInfo(pubkey);
    if (!info) return null;
    return decodeRawAccount<T>(schema, info.data);
  } catch { return null; }
}

/** Instruction discriminator bytes */
export const IXD = {
  initializePlatform: Buffer.from([119, 201, 101, 45, 75, 122, 89, 3]),
  createProject:      Buffer.from([148, 219, 181, 42, 221, 114, 145, 190]),
  updateFees:         Buffer.from([69, 112, 48, 223, 112, 10, 201, 138]),
  closeProject:       Buffer.from([117, 209, 53, 106, 93, 55, 112, 49]),
  createBox:          Buffer.from([108, 200, 91, 3, 44, 99, 31, 27]),
  updateBox:          Buffer.from([62, 12, 1, 241, 122, 67, 204, 99]),
  closeBox:           Buffer.from([255, 201, 78, 228, 223, 71, 133, 90]),
  initVault:          Buffer.from([48, 191, 163, 44, 71, 129, 63, 164]),
  createPrize:        Buffer.from([170, 186, 187, 121, 99, 208, 41, 158]),
  depositPrize:       Buffer.from([245, 164, 83, 19, 96, 75, 73, 130]),
  withdrawPrize:      Buffer.from([125, 86, 6, 204, 176, 159, 61, 119]),
  buyBox:             Buffer.from([189, 165, 151, 165, 208, 250, 244, 108]),
  openBox:            Buffer.from([225, 220, 10, 104, 173, 151, 214, 199]),
} as const;

/** PDA lookups */
export async function pdaPlatform() { return PublicKey.findProgramAddress([Buffer.from("platform")], PROGRAM_ID); }
export async function pdaProject(slug: string) { return PublicKey.findProgramAddress([Buffer.from("project"), Buffer.from(slug)], PROGRAM_ID); }
export async function pdaBox(project: PublicKey, boxId: number | bigint) {
  const id = typeof boxId === "number" ? Buffer.from(new Uint8Array(new BigUint64Array([BigInt(boxId)]).buffer)) : Buffer.from(new Uint8Array(new BigUint64Array([boxId]).buffer));
  return PublicKey.findProgramAddress([Buffer.from("box"), project.toBuffer(), id], PROGRAM_ID);
}
export async function pdaVault(project: PublicKey) { return PublicKey.findProgramAddress([Buffer.from("vault"), project.toBuffer()], PROGRAM_ID); }
export async function pdaReceipt(user: PublicKey, project: PublicKey) {
  return PublicKey.findProgramAddress([Buffer.from("receipt"), user.toBuffer(), project.toBuffer()], PROGRAM_ID);
}

export async function pdaPrizeItem(boxCfg: PublicKey, idx: number) {
  return PublicKey.findProgramAddress([Buffer.from("prize"), boxCfg.toBuffer(), Buffer.from([idx])], PROGRAM_ID);
}
