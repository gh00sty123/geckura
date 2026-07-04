import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import crypto from "crypto";
import IDL from "@/lib/idl.json";
import { supabase } from "@/lib/supabase";

const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

// Fetch project authority from Solana blockchain
const getProjectAuthority = async (slug: string): Promise<string | null> => {
  try {
    const conn = new Connection(RPC, "confirmed");
    const [projectPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("project"), Buffer.from(slug)],
      PGID
    );
    const accountInfo = await conn.getAccountInfo(projectPDA);
    if (!accountInfo) return null;
    
    const coder = new BorshAccountsCoder(IDL as any);
    const proj: any = coder.decode("Project", accountInfo.data);
    return proj?.authority?.toBase58() || null;
  } catch (err) {
    console.error("Error fetching project authority:", err);
    return null;
  }
};

// Verify single transaction signature on-chain
const verifyOnChainTx = async (
  sig: string,
  expectedUser: string,
  expectedProgramId: string
): Promise<boolean> => {
  try {
    const conn = new Connection(RPC, "confirmed");
    const tx = await conn.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed"
    });
    if (!tx || !tx.meta || tx.meta.err) return false;
    
    // Ensure the program ID is involved
    const accountKeys = tx.transaction.message.accountKeys.map(k => k.pubkey.toBase58());
    if (!accountKeys.includes(expectedProgramId)) return false;
    
    // Ensure the user was a signer of the transaction
    const signers = tx.transaction.message.accountKeys.filter(k => k.signer).map(k => k.pubkey.toBase58());
    if (!signers.includes(expectedUser)) return false;
    
    // Ensure logs indicate a box open event or instruction
    const logs = tx.meta.logMessages || [];
    const hasOpenLog = logs.some(log => 
      log.includes("BoxOpenEvent") || 
      log.includes("Program data:") || 
      log.includes("Instruction: open_box") ||
      log.includes("Instruction: request_open") || 
      log.includes("Instruction: reveal_open")
    );
    if (!hasOpenLog) return false;
    
    return true;
  } catch (err) {
    console.error("Error verifying on-chain transaction:", err);
    return false;
  }
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    
    let query = supabase
      .from("leaderboard")
      .select("*")
      .order("timestamp", { ascending: false });
      
    if (slug) {
      query = query.eq("slug", slug);
    }

    const { data: records, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Map database columns to match client expected JSON schema (camelCase compatibility if needed, or keeping them original)
    const formattedRecords = (records || []).map(r => ({
      slug: r.slug,
      sig: r.sig,
      user: r.user,
      boxConfig: r.box_config,
      timestamp: Number(r.timestamp),
      isSolBox: r.is_sol_box
    }));

    return NextResponse.json(formattedRecords);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Check for batch sync input (from Admin dashboard)
    if (Array.isArray(body)) {
      if (body.length === 0) {
        return NextResponse.json({ success: true, added: 0 });
      }
      
      // We require cryptographic authorization headers for batch syncing
      const signatureB64 = req.headers.get("X-Leaderboard-Signature");
      const signerStr = req.headers.get("X-Leaderboard-Signer");
      const timestampStr = req.headers.get("X-Leaderboard-Timestamp");
      
      if (!signatureB64 || !signerStr || !timestampStr) {
        return NextResponse.json({ error: "Unauthorized: Missing sync signature headers" }, { status: 401 });
      }
      
      // 1. Verify timestamp is fresh (within 5 minutes) to prevent replays
      const timestamp = parseInt(timestampStr, 10);
      const now = Math.floor(Date.now() / 1000);
      if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
        return NextResponse.json({ error: "Unauthorized: Signature expired" }, { status: 401 });
      }
      
      // 2. Verify message signature
      const slug = body[0].slug;
      const messageStr = `Sync leaderboard for ${slug} at ${timestamp}`;
      const messageBytes = new TextEncoder().encode(messageStr);
      const signatureBytes = Buffer.from(signatureB64, "base64");
      const publicKey = new PublicKey(signerStr);
      
      let isSignatureValid = false;
      try {
        const derBuffer = Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          publicKey.toBuffer()
        ]);
        const pubKeyObj = crypto.createPublicKey({
          key: derBuffer,
          format: "der",
          type: "spki"
        });
        isSignatureValid = crypto.verify(null, messageBytes, pubKeyObj, signatureBytes);
      } catch (err) {
        console.error("Crypto signature verification error:", err);
      }
      
      if (!isSignatureValid) {
        return NextResponse.json({ error: "Unauthorized: Invalid signature" }, { status: 401 });
      }
      
      // 3. Verify the signer is the authority of the project
      const expectedAuthority = await getProjectAuthority(slug);
      if (!expectedAuthority || expectedAuthority !== signerStr) {
        return NextResponse.json({ error: "Unauthorized: Signer is not the project authority" }, { status: 403 });
      }
      
      const recordsToInsert = [];
      for (const item of body) {
        const { slug: itemSlug, sig, user, boxConfig, isSolBox, timestamp: itemTimestamp } = item;
        if (itemSlug === slug && sig && user && boxConfig) {
          recordsToInsert.push({
            slug,
            sig,
            user,
            box_config: boxConfig,
            timestamp: itemTimestamp || Math.floor(Date.now() / 1000),
            is_sol_box: !!isSolBox
          });
        }
      }
      
      if (recordsToInsert.length > 0) {
        const { error: upsertErr } = await supabase
          .from("leaderboard")
          .upsert(recordsToInsert, { onConflict: "sig", ignoreDuplicates: true });
          
        if (upsertErr) {
          return NextResponse.json({ error: upsertErr.message }, { status: 500 });
        }
      }
      
      return NextResponse.json({ success: true, added: recordsToInsert.length });
    } else {
      // Single log record (from User purchase flow)
      const { slug, sig, user, boxConfig, isSolBox, timestamp } = body;
      if (!slug || !sig || !user || !boxConfig) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      // Verify the transaction signature on-chain to prevent fake score injections
      const isTxValid = await verifyOnChainTx(sig, user, PGID.toBase58());
      if (!isTxValid) {
        return NextResponse.json({ error: "Unauthorized: On-chain transaction verification failed" }, { status: 403 });
      }

      const { error: upsertErr } = await supabase
        .from("leaderboard")
        .upsert({
          slug,
          sig,
          user,
          box_config: boxConfig,
          timestamp: timestamp || Math.floor(Date.now() / 1000),
          is_sol_box: !!isSolBox
        }, { onConflict: "sig", ignoreDuplicates: true });

      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
