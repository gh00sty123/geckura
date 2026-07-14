import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder, BorshEventCoder } from "@coral-xyz/anchor";
import { getMint } from "@solana/spl-token";
import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import IDL from "@/lib/idl.json";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "CXX3hFgqL5bozH8pYbTtetMHVYWkHwcx46MwHeF7VVcv");
const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const eventCoder = new BorshEventCoder(IDL as any);

interface DecodedBoxOpenEvent {
  boxConfig: string;
  user: string;
  prizeIndex: number;
  slot: number;
  nonce: number;
  roll: number;
  won: boolean;
  prizeType: any;
  tokenMint: string;
  amountWon: number;
  timestamp: number;
}

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

// Verify single transaction signature on-chain and retrieve logs
const verifyOnChainTx = async (
  sig: string,
  expectedUser: string,
  expectedProgramId: string
): Promise<{ isValid: boolean; logs: string[] }> => {
  try {
    const conn = new Connection(RPC, "confirmed");
    const tx = await conn.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed"
    });
    if (!tx || !tx.meta || tx.meta.err) return { isValid: false, logs: [] };
    
    // Ensure the program ID is involved
    const accountKeys = tx.transaction.message.accountKeys.map(k => k.pubkey.toBase58());
    if (!accountKeys.includes(expectedProgramId)) return { isValid: false, logs: [] };
    
    // Ensure the user was a signer of the transaction
    const signers = tx.transaction.message.accountKeys.filter(k => k.signer).map(k => k.pubkey.toBase58());
    if (!signers.includes(expectedUser)) return { isValid: false, logs: [] };
    
    // Ensure logs indicate a box open event or instruction
    const logs = tx.meta.logMessages || [];
    const hasOpenLog = logs.some(log => 
      log.includes("BoxOpenEvent") || 
      log.includes("Program data:") || 
      log.includes("Instruction: open_box") ||
      log.includes("Instruction: request_open") || 
      log.includes("Instruction: reveal_open")
    );
    if (!hasOpenLog) return { isValid: false, logs: [] };
    
    return { isValid: true, logs };
  } catch (err) {
    console.error("Error verifying on-chain transaction:", err);
    return { isValid: false, logs: [] };
  }
};

function parseBoxOpenEventsFromLogs(logs: string[]): DecodedBoxOpenEvent[] {
  const events: DecodedBoxOpenEvent[] = [];
  for (const log of logs) {
    if (log.includes("Program data: ")) {
      try {
        const base64Str = log.split("Program data: ")[1].trim();
        const buf = Buffer.from(base64Str, "base64");
        const event = eventCoder.decode(buf as any);
        if (event && event.name === "BoxOpenEvent") {
          const data = event.data as any;
          events.push({
            boxConfig: (data.boxConfig ?? data.box_config)?.toBase58() || "",
            user: (data.user)?.toBase58() || "",
            prizeIndex: Number(data.prizeIndex ?? data.prize_index ?? 0),
            slot: Number(data.slot ?? 0),
            nonce: Number(data.nonce ?? 0),
            roll: Number(data.roll ?? 0),
            won: !!(data.won ?? data.Won),
            prizeType: data.prizeType ?? data.prize_type,
            tokenMint: (data.tokenMint ?? data.token_mint)?.toBase58() || "",
            amountWon: Number(data.amountWon ?? data.amount_won ?? 0),
            timestamp: Number(data.timestamp ?? 0),
          });
        }
      } catch (err) {
        console.error("Failed to decode program log event:", err);
      }
    }
  }
  return events;
}

async function formatPrizeInfo(conn: Connection, event: DecodedBoxOpenEvent): Promise<{ name: string; amountStr: string }> {
  if (!event.won) {
    return { name: "Better luck next time!", amountStr: "" };
  }
  
  let pType = "sol";
  const prizeTypeRaw = event.prizeType;
  if (typeof prizeTypeRaw === "object" && prizeTypeRaw !== null) {
    const keys = Object.keys(prizeTypeRaw).map(k => k.toLowerCase());
    if (keys.includes("spltoken") || keys.includes("token")) pType = "spltoken";
    else if (keys.includes("nft")) pType = "nft";
  } else if (typeof prizeTypeRaw === "number") {
    if (prizeTypeRaw === 1) pType = "spltoken";
    else if (prizeTypeRaw === 2) pType = "nft";
  }

  if (pType === "sol") {
    return { name: "Solana", amountStr: `${(event.amountWon / 1e9).toFixed(4)} SOL` };
  }

  // Check common mints
  if (event.tokenMint === "EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v") {
    return { name: "USDC", amountStr: `${(event.amountWon / 1e6).toFixed(2)} USDC` };
  }

  // Try fetching decimals dynamically
  try {
    const mintPk = new PublicKey(event.tokenMint);
    const mintInfo = await getMint(conn, mintPk);
    const decimals = mintInfo.decimals;
    const divider = Math.pow(10, decimals);
    const formattedAmount = (event.amountWon / divider).toString();
    
    if (pType === "nft" || (decimals === 0 && event.amountWon === 1)) {
      return { name: `NFT (${event.tokenMint.slice(0, 4)}...${event.tokenMint.slice(-4)})`, amountStr: `1 NFT` };
    }
    
    return { name: `Token (${event.tokenMint.slice(0, 4)}...${event.tokenMint.slice(-4)})`, amountStr: `${formattedAmount}` };
  } catch (err) {
    console.warn("Failed to fetch mint info dynamically:", err);
    const formattedAmount = (event.amountWon / 1e9).toString();
    return { name: `Token (${event.tokenMint.slice(0, 4)}...${event.tokenMint.slice(-4)})`, amountStr: `${formattedAmount} (decimals unknown)` };
  }
}

async function sendDiscordNotification(conn: Connection, event: DecodedBoxOpenEvent, sig: string, slug: string) {
  try {
    // Fetch project branding from database if configured
    let projectName = slug;
    let logoUri: string | null = null;
    let themeColorHex: string | null = null;
    let projectWebhookUrl: string | null = null;

    if (isSupabaseConfigured) {
      try {
        const { data: projData } = await supabase
          .from("projects")
          .select("name, logo_uri, theme_color, discord_webhook_url")
          .eq("slug", slug)
          .single();
        if (projData) {
          projectName = projData.name || slug;
          logoUri = projData.logo_uri || null;
          themeColorHex = projData.theme_color || null;
          projectWebhookUrl = projData.discord_webhook_url || null;
        }
      } catch (dbErr) {
        console.error("[Discord Webhook] Failed to fetch project branding:", dbErr);
      }
    }

    const targetWebhookUrl = projectWebhookUrl || DISCORD_WEBHOOK_URL;
    if (!targetWebhookUrl) {
      return;
    }

    const { name, amountStr } = await formatPrizeInfo(conn, event);
    const explorerUrl = `https://solscan.io/tx/${sig}`;
    const userExplorerUrl = `https://solscan.io/account/${event.user}`;

    const fields = [
      {
        name: "User Wallet",
        value: `[\`${event.user.slice(0, 6)}...${event.user.slice(-6)}\`](${userExplorerUrl})`,
        inline: true
      },
      {
        name: "Project",
        value: `**${projectName}**`,
        inline: true
      },
      {
        name: "Result",
        value: event.won ? `🏆 **Won:** ${amountStr} of **${name}**` : "🎁 Better luck next time!",
        inline: false
      },
      {
        name: "Solscan Transaction",
        value: `[View on Solscan](${explorerUrl})`,
        inline: false
      }
    ];

    // Convert hex color (e.g. #1cac64) to decimal for Discord Embed
    let embedColor = event.won ? 3066993 : 10070709; // default green/grey
    if (themeColorHex) {
      const cleanHex = themeColorHex.replace("#", "");
      const num = parseInt(cleanHex, 16);
      if (!isNaN(num)) {
        embedColor = num;
      }
    }

    const embed = {
      title: event.won ? "🎉 New Mystery Box Win!" : "🎁 Mystery Box Opened",
      color: embedColor,
      fields,
      thumbnail: logoUri ? { url: logoUri } : undefined,
      timestamp: new Date().toISOString(),
      footer: {
        text: `${projectName} Draw Alerts`,
        icon_url: logoUri || undefined
      }
    };

    const response = await fetch(targetWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `${projectName} Draw Bot`,
        avatar_url: logoUri || undefined,
        embeds: [embed]
      })
    });

    if (!response.ok) {
      console.error("[Discord Webhook] Failed to post message:", await response.text());
    }
  } catch (err) {
    console.error("[Discord Webhook] Error sending notification:", err);
  }
}


const PROFILES_FILE = path.join(process.cwd(), "src/lib/profiles_db.json");

function getLocalProfiles(): Record<string, { username: string; avatarUrl: string }> {
  try {
    if (fs.existsSync(PROFILES_FILE)) {
      return JSON.parse(fs.readFileSync(PROFILES_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    
    let records: any[] = [];
    if (isSupabaseConfigured) {
      let query = supabase
        .from("leaderboard")
        .select("*")
        .order("timestamp", { ascending: false });
        
      if (slug) {
        query = query.eq("slug", slug);
      }

      const { data, error } = await query;
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      records = data || [];
    } else {
      // Fallback to local leaderboard JSON if it exists
      const LEADERBOARD_FILE = path.join(process.cwd(), "src/lib/leaderboard_db.json");
      try {
        if (fs.existsSync(LEADERBOARD_FILE)) {
          const raw = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf-8"));
          records = slug ? raw.filter((r: any) => r.slug === slug) : raw;
        }
      } catch {}
    }

    // Load profiles (local + supabase)
    const localProfiles = getLocalProfiles();
    const profilesMap: Record<string, { username: string; avatarUrl: string }> = { ...localProfiles };

    if (isSupabaseConfigured) {
      try {
        const { data: dbProfiles } = await supabase.from("profiles").select("*");
        if (dbProfiles) {
          for (const p of dbProfiles) {
            profilesMap[p.wallet] = { username: p.username, avatarUrl: p.avatar_url };
          }
        }
      } catch {}
    }

    // Map database columns to match client expected JSON schema, filtering out legacy duplicates
    const formattedRecords: any[] = [];
    const compositeSigs = new Set<string>();

    for (const r of records) {
      if (r.sig && r.sig.includes("-")) {
        const baseSig = r.sig.split("-")[0];
        compositeSigs.add(baseSig);
      }
    }

    for (const r of records) {
      if (r.sig && !r.sig.includes("-") && compositeSigs.has(r.sig)) {
        // Skip legacy plain signature record since we have the split composite records
        continue;
      }
      formattedRecords.push({
        slug: r.slug,
        sig: r.sig,
        user: r.user,
        boxConfig: r.box_config || r.boxConfig,
        timestamp: Number(r.timestamp),
        isSolBox: r.is_sol_box || r.isSolBox,
        username: profilesMap[r.user]?.username || null,
        avatar: profilesMap[r.user]?.avatarUrl || null
      });
    }

    return NextResponse.json(formattedRecords);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isSupabaseConfigured) {
      if (Array.isArray(body)) {
        return NextResponse.json({ success: true, added: body.length });
      } else {
        return NextResponse.json({ success: true });
      }
    }
    
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
      const txResult = await verifyOnChainTx(sig, user, PGID.toBase58());
      if (!txResult.isValid) {
        return NextResponse.json({ error: "Unauthorized: On-chain transaction verification failed" }, { status: 403 });
      }

      // Send Discord notifications if configured, and parse open events
      const conn = new Connection(RPC, "confirmed");
      const events = parseBoxOpenEventsFromLogs(txResult.logs);

      if (DISCORD_WEBHOOK_URL) {
        for (const ev of events) {
          sendDiscordNotification(conn, ev, sig, slug).catch(err => {
            console.error("[Discord Webhook] Async send failed:", err);
          });
        }
      }

      const recordsToInsert = [];
      if (events.length > 0) {
        for (const ev of events) {
          recordsToInsert.push({
            slug,
            sig: `${sig}-${ev.nonce}`,
            user,
            box_config: ev.boxConfig || boxConfig,
            timestamp: ev.timestamp || timestamp || Math.floor(Date.now() / 1000),
            is_sol_box: !!isSolBox
          });
        }
      } else {
        // Fallback in case logs parsed 0 events but tx was verified
        recordsToInsert.push({
          slug,
          sig,
          user,
          box_config: boxConfig,
          timestamp: timestamp || Math.floor(Date.now() / 1000),
          is_sol_box: !!isSolBox
        });
      }

      const { error: upsertErr } = await supabase
        .from("leaderboard")
        .upsert(recordsToInsert, { onConflict: "sig", ignoreDuplicates: true });

      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
