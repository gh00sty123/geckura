import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const PROFILES_FILE = path.join(process.cwd(), "src/lib/profiles_db.json");

function getLocalProfiles(): Record<string, { username: string; avatarUrl: string }> {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILES_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

function saveLocalProfile(wallet: string, username: string, avatarUrl: string) {
  try {
    const dir = path.dirname(PROFILES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = getLocalProfiles();
    data[wallet] = { username, avatarUrl };
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save local profile:", err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get("wallet");
    if (!wallet) {
      return NextResponse.json({ error: "Missing wallet parameter" }, { status: 400 });
    }

    // Try fetching from Supabase if configured
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("username, avatar_url")
          .eq("wallet", wallet)
          .single();
        if (data && !error) {
          return NextResponse.json({
            username: data.username,
            avatarUrl: data.avatar_url
          });
        }
      } catch {}
    }

    // Fallback to local profiles json
    const local = getLocalProfiles();
    if (local[wallet]) {
      return NextResponse.json(local[wallet]);
    }

    return NextResponse.json({ username: null, avatarUrl: null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { wallet, username, avatarUrl, signature, timestamp } = await req.json();

    if (!wallet || !username || !signature || !timestamp) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. Verify signature freshness (within 10 minutes)
    const timeDiff = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (timeDiff > 600) {
      return NextResponse.json({ error: "Unauthorized: Signature expired" }, { status: 401 });
    }

    // 2. Verify signature using standard Solana Ed25519 verification
    const messageStr = `Update profile for ${wallet} at ${timestamp}`;
    const messageBytes = new TextEncoder().encode(messageStr);
    const signatureBytes = Buffer.from(signature, "base64");
    const publicKey = new PublicKey(wallet);

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
      console.error("Crypto verification error:", err);
    }

    if (!isSignatureValid) {
      return NextResponse.json({ error: "Unauthorized: Invalid signature" }, { status: 401 });
    }

    // 3. Save profile locally
    saveLocalProfile(wallet, username, avatarUrl || "");

    // 4. Save to Supabase if configured
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase
          .from("profiles")
          .upsert({
            wallet,
            username,
            avatar_url: avatarUrl || null,
            updated_at: new Date().toISOString()
          }, { onConflict: "wallet" });
        if (error) {
          console.error("Supabase profile save error:", error.message);
        }
      } catch (err) {
        console.error("Supabase profile write exception:", err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
