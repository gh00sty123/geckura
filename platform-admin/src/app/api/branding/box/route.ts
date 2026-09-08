import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import crypto from "crypto";
import IDL from "@/lib/idl.json";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "HnysT79HmiJWWtE8W2LWbhBeXk27RxoohbJ4cQyw8AKr");
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { slug, boxId, name, description, bannerUri } = body;

    if (!slug || boxId === undefined || !name) {
      return NextResponse.json({ error: "Missing required fields: slug, boxId, and name" }, { status: 400 });
    }

    if (!isSupabaseConfigured) {
      return NextResponse.json({ success: true });
    }

    // Cryptographic signature verification headers
    const signatureB64 = req.headers.get("X-Branding-Signature");
    const signerStr = req.headers.get("X-Branding-Signer");
    const timestampStr = req.headers.get("X-Branding-Timestamp");

    if (!signatureB64 || !signerStr || !timestampStr) {
      return NextResponse.json({ error: "Unauthorized: Missing signature headers" }, { status: 401 });
    }

    // 1. Verify timestamp to prevent replay attacks (5 minute window)
    const timestamp = parseInt(timestampStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
      return NextResponse.json({ error: "Unauthorized: Signature expired" }, { status: 401 });
    }

    // 2. Verify signature
    const messageStr = `Update box branding for ${slug} box ${boxId} at ${timestamp}`;
    const messageBytes = new TextEncoder().encode(messageStr);
    const signatureBytes = Buffer.from(signatureB64, "base64");
    const publicKey = new PublicKey(signerStr);

    let isSignatureValid = false;
    try {
      const derBuffer = Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        publicKey.toBuffer(),
      ]);
      const pubKeyObj = crypto.createPublicKey({
        key: derBuffer,
        format: "der",
        type: "spki",
      });
      isSignatureValid = crypto.verify(null, messageBytes, pubKeyObj, signatureBytes);
    } catch (err) {
      console.error("Crypto signature verification error:", err);
    }

    if (!isSignatureValid) {
      return NextResponse.json({ error: "Unauthorized: Invalid signature" }, { status: 401 });
    }

    // 3. Verify the signer is the designated project authority on-chain
    const expectedAuthority = await getProjectAuthority(slug);
    if (!expectedAuthority || expectedAuthority !== signerStr) {
      return NextResponse.json({ error: "Unauthorized: Signer is not the project authority" }, { status: 403 });
    }

    // 4. Ensure project exists in projects table (so foreign key does not fail)
    // If project doesn't exist, we can create a dummy placeholder that will be updated later
    const { data: project, error: checkErr } = await supabase
      .from("projects")
      .select("slug")
      .eq("slug", slug)
      .single();

    if (checkErr && checkErr.code === "PGRST116") {
      const { error: insertProjErr } = await supabase
        .from("projects")
        .insert({ slug, name: slug });
      if (insertProjErr) {
        return NextResponse.json({ error: insertProjErr.message }, { status: 500 });
      }
    }

    // 5. Upsert box branding into Supabase
    const { error: upsertErr } = await supabase
      .from("boxes")
      .upsert({
        project_slug: slug,
        box_id: boxId,
        name,
        description: description || null,
        banner_uri: bannerUri || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "project_slug,box_id" });

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
