import { AnchorProvider, Program, setProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { useMemo } from "react";
import IDL from "@/lib/idl.json";

export function getProgram(connection: Connection, wallet: any): Program | null {
  try {
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    setProvider(provider);
    return new Program(IDL as any, provider);
  } catch {
    return null;
  }
}

export function useProgram(connection: Connection | null, wallet: any): Program | null {
  return useMemo(() => (connection && wallet ? getProgram(connection, wallet) : null), [connection, wallet]);
}

/* PDAs */

export const PLATFORM_SEED = Buffer.from("platform");
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4"
);

export async function platformPDA(): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress([PLATFORM_SEED], PROGRAM_ID);
}

export async function projectPDA(slug: string): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress([Buffer.from("project"), Buffer.from(slug)], PROGRAM_ID);
}

export async function boxPDA(project: PublicKey, boxId: number | bigint): Promise<[PublicKey, number]> {
  const buf = typeof boxId === "bigint"
    ? Buffer.from(new Uint8Array(new BigUint64Array([boxId]).buffer))
    : Buffer.from(new Uint8Array(new BigUint64Array([BigInt(boxId)]).buffer));
  return PublicKey.findProgramAddress([Buffer.from("box"), project.toBuffer(), buf], PROGRAM_ID);
}

export async function vaultPDA(project: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress([Buffer.from("vault"), project.toBuffer()], PROGRAM_ID);
}

/* Retry helper — exponential backoff, skips non-retryable errors */

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1_000;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Solana RPC: getProgramAccounts from the same RPC node
    if (msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit")) return true;
    // @solana/web3.js wraps HTTP errors as MaxRetriesExceededError
    const name = (err as any).constructor?.name ?? "";
    if (name === "MaxRetriesExceededError") return true;
    // HTTP error with status property
    if ((err as any).status === 429 || (err as any).statusCode === 429) return true;
  }
  return false;
}

/** Retries `fn` with exponential backoff. Throws after `MAX_RETRIES` failures. */
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

export async function receiptPDA(user: PublicKey, boxConfig: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddress(
    [Buffer.from("receipt"), user.toBuffer(), boxConfig.toBuffer()],
    PROGRAM_ID,
  );
}
