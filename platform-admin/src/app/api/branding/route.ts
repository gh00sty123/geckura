import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import crypto from "crypto";
import IDL from "@/lib/idl.json";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

import { RPC_URL } from "@/lib/env";
import { projectPDASync } from "@/lib/program-ix";

const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "5GA4F3dUw4uZc63UFRQxcyqZBA1TMvDG9p9XzAVCojwD");
const RPC = RPC_URL;

// Fetch project authority from Solana blockchain
const getProjectAuthority = async (slug: string): Promise<string | null> => {
  try {
    const conn = new Connection(RPC, "confirmed");
    const [projectPDA] = projectPDASync(slug);
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    if (!slug) {
      return NextResponse.json({ error: "Missing slug parameter" }, { status: 400 });
    }

    if (!isSupabaseConfigured) {
      return NextResponse.json({ success: true, project: null });
    }

    // 1. Fetch project branding
    let { data: project, error: projErr } = await supabase
      .from("projects")
      .select("*")
      .eq("slug", slug)
      .single();

    if (!project) {
      // Fallback 1: try 'geckura' if slug was numeric or default
      const { data: fallbackProj } = await supabase
        .from("projects")
        .select("*")
        .eq("slug", "geckura")
        .single();
      if (fallbackProj) {
        project = fallbackProj;
      } else {
        // Fallback 2: fetch any available project row in Supabase
        const { data: anyProj } = await supabase
          .from("projects")
          .select("*")
          .limit(1)
          .single();
        if (anyProj) project = anyProj;
      }
    }

    if (!project) {
      return NextResponse.json({ success: true, project: null });
    }

    const actualSlug = project.slug || slug;

    // 2. Fetch related boxes
    const { data: boxes, error: boxErr } = await supabase
      .from("boxes")
      .select("*")
      .eq("project_slug", actualSlug);

    if (boxErr) {
      return NextResponse.json({ error: boxErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      project: {
        ...project,
        boxes: boxes || [],
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      slug,
      name,
      logoUri,
      bgUri,
      description,
      themeColor,
      navbarColor,
      textColor,
      nothingRewardImage,
      twitterUsername,
      magicEdenLink,
      discordLink,
      twitterLink,
      discordWebhookUrl,
      discordRoleId,
    } = body;

    if (!slug || !name) {
      return NextResponse.json({ error: "Missing required fields: slug and name" }, { status: 400 });
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
    const messageStr = `Update branding for ${slug} at ${timestamp}`;
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

    // 4. Upsert project branding into Supabase
    const { error: upsertErr } = await supabase
      .from("projects")
      .upsert({
        slug,
        name,
        description,
        logo_uri: logoUri || null,
        bg_uri: bgUri || null,
        theme_color: themeColor || "#1cac64",
        navbar_color: navbarColor || null,
        text_color: textColor || null,
        nothing_reward_image: nothingRewardImage || null,
        twitter_username: twitterUsername || null,
        magic_eden_link: magicEdenLink || null,
        discord_link: discordLink || null,
        twitter_link: twitterLink || null,
        discord_webhook_url: discordWebhookUrl || null,
        discord_role_id: discordRoleId || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "slug" });

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
