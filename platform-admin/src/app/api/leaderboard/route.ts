import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder, BorshEventCoder } from "@coral-xyz/anchor";
import { getMint } from "@solana/spl-token";
import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import IDL from "@/lib/idl.json";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const PGID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "5GA4F3dUw4uZc63UFRQxcyqZBA1TMvDG9p9XzAVCojwD");
const RPC = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
const DEFAULT_DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1526660578867675156/QKVdqrV2dw-ZsCQhQX-mIL_7I-9lAMl4g5eh9THUkQJJZbSCuk-HjioishNkzJCewlpf";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || DEFAULT_DISCORD_WEBHOOK_URL;

const KNOWN_PROGRAM_IDS = [
  "5GA4F3dUw4uZc63UFRQxcyqZBA1TMvDG9p9XzAVCojwD",
  "AEQrvbZvGwGcat5FXDXXZD71NiQsWNfdxvDFvdigxL5t",
  "DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4"
];
if (process.env.NEXT_PUBLIC_PROGRAM_ID && !KNOWN_PROGRAM_IDS.includes(process.env.NEXT_PUBLIC_PROGRAM_ID)) {
  KNOWN_PROGRAM_IDS.push(process.env.NEXT_PUBLIC_PROGRAM_ID);
}

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
    let tx: any = null;

    // Retry up to 6 times with 800ms delay to account for RPC index lag
    for (let attempt = 0; attempt < 6; attempt++) {
      tx = await conn.getParsedTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed"
      });
      if (tx && tx.meta && !tx.meta.err) break;
      await new Promise(r => setTimeout(r, 800));
    }

    if (!tx || !tx.meta || tx.meta.err) {
      console.warn(`[Leaderboard Verify] Could not find parsed tx or tx had error for sig: ${sig}`);
      return { isValid: false, logs: [] };
    }

    const accountKeys = tx.transaction.message.accountKeys.map((k: any) => 
      typeof k === "string" ? k : (k.pubkey?.toBase58?.() || String(k.pubkey || k))
    );

    const matchesProgram = accountKeys.some((pk: string) => KNOWN_PROGRAM_IDS.includes(pk) || pk === expectedProgramId);
    if (!matchesProgram) {
      console.warn(`[Leaderboard Verify] Tx ${sig} does not involve any known program ID. Keys:`, accountKeys);
      return { isValid: false, logs: [] };
    }

    const isUserInvolved = accountKeys.includes(expectedUser);
    if (!isUserInvolved) {
      console.warn(`[Leaderboard Verify] Tx ${sig} does not involve user ${expectedUser}. Keys:`, accountKeys);
      return { isValid: false, logs: [] };
    }

    const logs = tx.meta.logMessages || [];
    const hasOpenLog = logs.some((log: string) => 
      log.includes("BoxOpenEvent") || 
      log.includes("Program data:") || 
      log.includes("Instruction: open_box") ||
      log.includes("Instruction: request_open") || 
      log.includes("Instruction: reveal_open") ||
      log.includes("Instruction:")
    );
    if (!hasOpenLog) {
      console.warn(`[Leaderboard Verify] Tx ${sig} does not contain open box logs. Logs:`, logs);
      return { isValid: false, logs: [] };
    }

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
        // Pass base64 string directly to eventCoder.decode (passing a Buffer causes base64.decode to fail in Anchor)
        const event = eventCoder.decode(base64Str);
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

const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

function resolveIpfsUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("ipfs://")) {
    return url.replace("ipfs://", "https://ipfs.io/ipfs/");
  }
  if (url.startsWith("ar://")) {
    return url.replace("ar://", "https://arweave.net/");
  }
  return url;
}

function parseMetaplexMetadata(data: Buffer | Uint8Array) {
  try {
    if (data.length < 319) return null;
    const nameBytes = data.slice(69, 69 + 32);
    const name = new TextDecoder().decode(nameBytes).replace(/\0/g, "").trim();
    const symbolBytes = data.slice(105, 105 + 10);
    const symbol = new TextDecoder().decode(symbolBytes).replace(/\0/g, "").trim();
    const uriBytes = data.slice(119, 119 + 200);
    let uri = new TextDecoder().decode(uriBytes).replace(/\0/g, "").trim();
    const httpIdx = uri.indexOf("http");
    if (httpIdx >= 0) {
      uri = uri.slice(httpIdx);
    } else {
      const ipfsIdx = uri.indexOf("ipfs://");
      if (ipfsIdx >= 0) uri = uri.slice(ipfsIdx);
      else {
        const arIdx = uri.indexOf("ar://");
        if (arIdx >= 0) uri = uri.slice(arIdx);
      }
    }
    return { name, symbol, uri };
  } catch (e) {
    return null;
  }
}

function formatNumberWithCommas(num: number): string {
  if (Number.isInteger(num)) {
    return num.toLocaleString("en-US");
  }
  return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

async function formatPrizeInfo(conn: Connection, event: DecodedBoxOpenEvent): Promise<{ name: string; amountStr: string; imageUrl: string }> {
  const defaultChestImage = "https://i.imgur.com/8QO2HkQ.png";
  if (!event.won) {
    return { 
      name: "Better luck next time!", 
      amountStr: "", 
      imageUrl: "https://i.imgur.com/k2B11aA.png" // Closed Chest for Loss
    };
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

  const mintStr = event.tokenMint || "";

  // Geckura $GAURA Token
  if (mintStr.startsWith("5xUbTjh")) {
    const rawVal = event.amountWon;
    const divided = rawVal >= 1000000 ? rawVal / 1e6 : rawVal;
    return {
      name: "$GAURA",
      amountStr: `${formatNumberWithCommas(divided)} $GAURA`,
      imageUrl: "https://gateway.irys.xyz/6-zHeDEpHIOc_nbiMzOykATzSEZp4jkT369BIQigRMo"
    };
  }

  // Geckura Free Mint Ticket
  if (mintStr.startsWith("8734tKb8")) {
    const rawVal = event.amountWon;
    const divided = rawVal >= 1000000 ? rawVal / 1e6 : rawVal;
    const freeMintVal = divided > 0 ? divided : 1;
    return {
      name: "Geckura Free Mint",
      amountStr: `${formatNumberWithCommas(freeMintVal)} Free Mint Ticket${freeMintVal > 1 ? "s" : ""}`,
      imageUrl: "https://gateway.irys.xyz/YPWTFjbx1MQw3vfdgSCWi6Ki_0BTTpDK3UdW75sp63E"
    };
  }

  if (pType === "sol" || !event.tokenMint || event.tokenMint === "11111111111111111111111111111111") {
    const solVal = event.amountWon > 1e6 ? event.amountWon / 1e9 : event.amountWon;
    return { 
      name: "Solana (SOL)", 
      amountStr: `${formatNumberWithCommas(solVal)} SOL`,
      imageUrl: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
    };
  }

  // Check common mints
  if (event.tokenMint === "EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v") {
    const usdcVal = event.amountWon > 1e4 ? event.amountWon / 1e6 : event.amountWon;
    return { 
      name: "USDC", 
      amountStr: `${formatNumberWithCommas(usdcVal)} USDC`,
      imageUrl: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v/logo.png"
    };
  }

  // Try fetching mint info & Metaplex metadata dynamically
  try {
    const mintPk = new PublicKey(event.tokenMint);
    let decimals = 0;
    try {
      const mintInfo = await getMint(conn, mintPk);
      decimals = mintInfo.decimals;
    } catch {}

    const divider = decimals > 0 ? Math.pow(10, decimals) : 1;
    let numVal = event.amountWon > 0 && decimals > 0 ? event.amountWon / divider : event.amountWon;
    if (numVal === 0) numVal = 1;

    let tokenName = pType === "nft" ? "NFT" : `Token (${event.tokenMint.slice(0, 4)}...${event.tokenMint.slice(-4)})`;
    let assetImage = defaultChestImage;

    // Fetch Metaplex metadata on-chain for exact token/NFT name & image
    try {
      const [metadataPk] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
        METAPLEX_PROGRAM_ID
      );
      const accInfo = await conn.getAccountInfo(metadataPk);
      if (accInfo && accInfo.data) {
        const parsedMeta = parseMetaplexMetadata(accInfo.data);
        if (parsedMeta) {
          if (parsedMeta.name) tokenName = parsedMeta.name;
          if (parsedMeta.uri) {
            const uriUrl = resolveIpfsUrl(parsedMeta.uri);
            const metaRes = await fetch(uriUrl).catch(() => null);
            if (metaRes && metaRes.ok) {
              const json = await metaRes.json().catch(() => null);
              if (json && json.image) {
                assetImage = resolveIpfsUrl(json.image);
              }
              if (json && json.name) tokenName = json.name;
            }
          }
        }
      }
    } catch (metaErr) {
      console.warn("Could not fetch Metaplex metadata:", metaErr);
    }

    const amountStr = pType === "nft" ? `1 ${tokenName}` : `${formatNumberWithCommas(numVal)} ${tokenName}`;
    return { 
      name: tokenName, 
      amountStr,
      imageUrl: assetImage 
    };
  } catch (err) {
    console.warn("Failed to fetch mint info dynamically:", err);
    return { 
      name: `Asset (${event.tokenMint.slice(0, 4)}...${event.tokenMint.slice(-4)})`, 
      amountStr: `${formatNumberWithCommas(event.amountWon)}`,
      imageUrl: defaultChestImage
    };
  }
}

const SOLD_OUT_FILE = path.join(process.cwd(), "src/lib/sold_out_boxes.json");
const notifiedSoldOutBoxes = new Set<string>();

function loadSoldOutBoxes(): Set<string> {
  try {
    if (fs.existsSync(SOLD_OUT_FILE)) {
      const data = JSON.parse(fs.readFileSync(SOLD_OUT_FILE, "utf-8"));
      if (Array.isArray(data)) {
        data.forEach((id: string) => notifiedSoldOutBoxes.add(id));
      }
    }
  } catch {}
  return notifiedSoldOutBoxes;
}

function saveSoldOutBox(boxPkStr: string) {
  notifiedSoldOutBoxes.add(boxPkStr);
  try {
    const list = Array.from(notifiedSoldOutBoxes);
    fs.writeFileSync(SOLD_OUT_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch {}
}

loadSoldOutBoxes();

async function checkAndSendSoldOutNotification(
  conn: Connection,
  boxConfigPkStr: string,
  slug: string,
  targetWebhookUrl: string,
  discordRoleId: string | null,
  projectName: string,
  logoUri: string | null
) {
  try {
    if (!boxConfigPkStr || notifiedSoldOutBoxes.has(boxConfigPkStr)) return;
    const boxPk = new PublicKey(boxConfigPkStr);
    const accInfo = await conn.getAccountInfo(boxPk);
    if (!accInfo) return;

    const coder = new BorshAccountsCoder(IDL as any);
    const boxConfig: any = coder.decode("BoxConfig", accInfo.data);
    if (!boxConfig) return;

    const sold = Number(boxConfig.sold ?? 0);
    const supply = Number(boxConfig.supply ?? 0);

    if (supply > 0 && sold >= supply) {
      saveSoldOutBox(boxConfigPkStr);
      const boxName = boxConfig.name || "Mystery Box";
      const siteBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://mysterybox.geckura.app";
      const boxSiteUrl = `${siteBaseUrl}/${slug}`;

      const embed = {
        title: "🔥 BOX SOLD OUT! 📦",
        url: boxSiteUrl,
        description: `🎉 **The "${boxName}" box for ${projectName} is now 100% SOLD OUT!**\n\n📦 **Total Supply:** **${sold} / ${supply}** claimed!\n\nThank you to everyone who participated! 🚀`,
        color: 15158332,
        timestamp: new Date().toISOString(),
        footer: {
          text: `${projectName} Sold Out Announcement`,
          icon_url: logoUri || undefined
        }
      };

      await fetch(targetWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: discordRoleId ? `<@&${discordRoleId}>` : undefined,
          username: "Geckura Draws",
          avatar_url: logoUri || undefined,
          embeds: [embed]
        })
      });
      console.log(`[Discord Webhook] Sent Box Sold Out notification for box ${boxConfigPkStr}`);
    }
  } catch (err) {
    console.error("[Discord SoldOut Webhook] Error sending sold out notification:", err);
  }
}

async function sendDiscordNotification(conn: Connection, event: DecodedBoxOpenEvent, sig: string, slug: string) {
  try {
    // Fetch project branding from database if configured
    let projectName = slug;
    let logoUri: string | null = null;
    let themeColorHex: string | null = null;
    let projectWebhookUrl: string | null = null;
    let discordRoleId: string | null = null;

    if (isSupabaseConfigured) {
      try {
        const { data: projData } = await supabase
          .from("projects")
          .select("name, logo_uri, theme_color, discord_webhook_url, discord_role_id")
          .eq("slug", slug)
          .single();
        if (projData) {
          projectName = projData.name || slug;
          logoUri = projData.logo_uri || null;
          themeColorHex = projData.theme_color || null;
          projectWebhookUrl = projData.discord_webhook_url || null;
          discordRoleId = projData.discord_role_id || null;
        }
      } catch (dbErr) {
        console.error("[Discord Webhook] Failed to fetch project branding:", dbErr);
      }
    }

    const targetWebhookUrl = projectWebhookUrl || DISCORD_WEBHOOK_URL;
    if (!targetWebhookUrl) {
      return;
    }

    // Resolve player custom profile name
    const walletStr = typeof event.user === "string" ? event.user : ((event.user as any).toBase58?.() || String(event.user));
    let username = `${walletStr.slice(0, 6)}...${walletStr.slice(-6)}`;
    if (isSupabaseConfigured) {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("wallet", walletStr)
          .single();
        if (profile?.username) {
          username = profile.username;
        }
      } catch {}
    }

    const { name, amountStr, imageUrl } = await formatPrizeInfo(conn, event);
    const explorerUrl = `https://solscan.io/tx/${sig}`;
    const userExplorerUrl = `https://solscan.io/account/${walletStr}`;

    // Build the storefront URL for this project
    const siteBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://mysterybox.geckura.app";
    const boxSiteUrl = `${siteBaseUrl}/${slug}`;

    const rewardText = event.won 
      ? `🏆 **Won:** **${amountStr}**` 
      : "🎁 **Better luck next time!**";

    const description = `
👤 **Player:** [${username}](${userExplorerUrl})
📦 **Project:** **${projectName}**
✨ **Result:** ${rewardText}

🔗 **Transaction:** [View on Solscan](${explorerUrl})
🎰 **Try Your Luck:** [Open a Box!](${boxSiteUrl})
    `.trim();

    // Convert hex color (e.g. #1cac64) to decimal for Discord Embed
    let embedColor = event.won ? 3066993 : 10070709; // default green/grey
    if (themeColorHex) {
      const cleanHex = themeColorHex.replace("#", "");
      const num = parseInt(cleanHex, 16);
      if (!isNaN(num)) {
        embedColor = num;
      }
    }

    const validLogo = (logoUri && typeof logoUri === "string" && logoUri.startsWith("http")) ? logoUri : undefined;
    const validImage = (imageUrl && typeof imageUrl === "string" && imageUrl.startsWith("http")) ? imageUrl : "https://i.imgur.com/8QO2HkQ.png";

    const embed: any = {
      title: event.won ? "🎉 New Mystery Box Win!" : "🎁 Mystery Box Opened",
      url: boxSiteUrl,
      description,
      color: embedColor,
      thumbnail: { url: validImage },
      image: { url: validImage },
      timestamp: new Date().toISOString(),
      footer: {
        text: `${projectName} Draw Alerts`,
        icon_url: validLogo
      }
    };
    // Use project logo as the author icon if available
    if (validLogo) {
      embed.author = {
        name: projectName,
        url: boxSiteUrl,
        icon_url: validLogo
      };
    }

    const response = await fetch(targetWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: discordRoleId ? `<@&${discordRoleId}>` : undefined,
        username: "Geckura Draws",
        avatar_url: validLogo,
        embeds: [embed]
      })
    });

    if (!response.ok) {
      console.error("[Discord Webhook] Failed to post message:", await response.text());
    }

    // Check if box is sold out and broadcast notification if so
    if (event.boxConfig) {
      await checkAndSendSoldOutNotification(conn, event.boxConfig, slug, targetWebhookUrl, discordRoleId, projectName, logoUri);
    }
  } catch (err) {
    console.error("[Discord Webhook] Error sending notification:", err);
  }
}

async function sendDiscordDirectNotification(
  conn: Connection,
  wonRewards: Array<{ name: string; amount: number; image?: string; isSol?: boolean; isNFT?: boolean; symbol?: string }>,
  sig: string,
  user: string,
  slug: string,
  boxConfig: string
) {
  try {
    let projectName = slug;
    let logoUri: string | null = null;
    let themeColorHex: string | null = null;
    let projectWebhookUrl: string | null = null;
    let discordRoleId: string | null = null;

    if (isSupabaseConfigured) {
      try {
        const { data: projData } = await supabase
          .from("projects")
          .select("name, logo_uri, theme_color, discord_webhook_url, discord_role_id")
          .eq("slug", slug)
          .single();
        if (projData) {
          projectName = projData.name || slug;
          logoUri = projData.logo_uri || null;
          themeColorHex = projData.theme_color || null;
          projectWebhookUrl = projData.discord_webhook_url || null;
          discordRoleId = projData.discord_role_id || null;
        }
      } catch (dbErr) {
        console.error("[Discord Webhook Direct] Failed to fetch project branding:", dbErr);
      }
    }

    const targetWebhookUrl = projectWebhookUrl || DISCORD_WEBHOOK_URL;
    if (!targetWebhookUrl) return;

    let username = `${user.slice(0, 6)}...${user.slice(-6)}`;
    if (isSupabaseConfigured) {
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("wallet", user)
          .single();
        if (profile?.username) username = profile.username;
      } catch {}
    }

    const explorerUrl = `https://solscan.io/tx/${sig}`;
    const userExplorerUrl = `https://solscan.io/account/${user}`;
    const siteBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://mysterybox.geckura.app";
    const boxSiteUrl = `${siteBaseUrl}/${slug}`;

    const validLogo = (logoUri && typeof logoUri === "string" && logoUri.startsWith("http")) ? logoUri : undefined;

    let embedColor = 3066993;
    if (themeColorHex) {
      const cleanHex = themeColorHex.replace("#", "");
      const num = parseInt(cleanHex, 16);
      if (!isNaN(num)) embedColor = num;
    }

    for (const reward of wonRewards) {
      const isWin = reward.amount > 0 || (reward.name && reward.name !== "Better luck next time!");
      const amountText = reward.amount > 0 
        ? `${formatNumberWithCommas(reward.amount)} ${reward.symbol || reward.name}`
        : reward.name;
      const rewardText = isWin 
        ? `🏆 **Won:** **${amountText}**` 
        : "🎁 **Better luck next time!**";

      const description = `
👤 **Player:** [${username}](${userExplorerUrl})
📦 **Project:** **${projectName}**
✨ **Result:** ${rewardText}

🔗 **Transaction:** [View on Solscan](${explorerUrl})
🎰 **Try Your Luck:** [Open a Box!](${boxSiteUrl})
      `.trim();

      const image = (reward.image && typeof reward.image === "string" && reward.image.startsWith("http"))
        ? reward.image
        : "https://i.imgur.com/8QO2HkQ.png";

      const embed: any = {
        title: isWin ? "🎉 New Mystery Box Win!" : "🎁 Mystery Box Opened",
        url: boxSiteUrl,
        description,
        color: isWin ? embedColor : 10070709,
        thumbnail: { url: image },
        image: { url: image },
        timestamp: new Date().toISOString(),
        footer: {
          text: `${projectName} Draw Alerts`,
          icon_url: validLogo
        }
      };

      if (validLogo) {
        embed.author = { name: projectName, url: boxSiteUrl, icon_url: validLogo };
      }

      await fetch(targetWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: discordRoleId ? `<@&${discordRoleId}>` : undefined,
          username: "Geckura Draws",
          avatar_url: validLogo,
          embeds: [embed]
        })
      }).catch(err => console.error("[Discord Direct Webhook] Post error:", err));
    }

    if (boxConfig) {
      await checkAndSendSoldOutNotification(conn, boxConfig, slug, targetWebhookUrl, discordRoleId, projectName, logoUri);
    }
  } catch (err) {
    console.error("[Discord Direct Webhook] Error:", err);
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
        if (isSupabaseConfigured) {
          const { error: upsertErr } = await supabase
            .from("leaderboard")
            .upsert(recordsToInsert, { onConflict: "sig", ignoreDuplicates: true });
            
          if (upsertErr) {
            return NextResponse.json({ error: upsertErr.message }, { status: 500 });
          }
        } else {
          const LEADERBOARD_FILE = path.join(process.cwd(), "src/lib/leaderboard_db.json");
          try {
            let currentRecords: any[] = [];
            if (fs.existsSync(LEADERBOARD_FILE)) {
              currentRecords = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf-8"));
            }
            for (const newRec of recordsToInsert) {
              if (!currentRecords.some((r: any) => r.sig === newRec.sig)) {
                currentRecords.push({
                  slug: newRec.slug,
                  sig: newRec.sig,
                  user: newRec.user,
                  boxConfig: newRec.box_config,
                  timestamp: newRec.timestamp,
                  isSolBox: newRec.is_sol_box
                });
              }
            }
            fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(currentRecords, null, 2), "utf-8");
          } catch (fileErr) {
            console.error("[Leaderboard File] Failed to write local leaderboard batch:", fileErr);
          }
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
      let txResult = await verifyOnChainTx(sig, user, PGID.toBase58());
      
      if (!txResult.isValid) {
        // Fallback check on-chain signature status directly if log indexing lags
        try {
          const connCheck = new Connection(RPC, "confirmed");
          const status = await connCheck.getSignatureStatus(sig);
          if (status?.value && !status.value.err) {
            txResult = { isValid: true, logs: [] };
          }
        } catch {}
      }

      if (!txResult.isValid) {
        return NextResponse.json({ error: "Unauthorized: On-chain transaction verification failed" }, { status: 403 });
      }

      // Send Discord notifications if configured, and parse open events
      const conn = new Connection(RPC, "confirmed");
      const events = parseBoxOpenEventsFromLogs(txResult.logs);
      const wonRewards = Array.isArray(body.wonRewards) ? body.wonRewards : null;

      if (wonRewards && wonRewards.length > 0) {
        sendDiscordDirectNotification(conn, wonRewards, sig, user, slug, boxConfig).catch(err => {
          console.error("[Discord Direct Webhook] Async send failed:", err);
        });
      } else if (events.length > 0) {
        for (const ev of events) {
          sendDiscordNotification(conn, ev, sig, slug).catch(err => {
            console.error("[Discord Webhook] Async send failed:", err);
          });
        }
      } else {
        // Fallback Discord notification in case logs parsed 0 events but tx was verified
        const fallbackEv: DecodedBoxOpenEvent = {
          boxConfig,
          user,
          prizeIndex: 0,
          slot: 0,
          nonce: 0,
          roll: 0,
          won: true,
          prizeType: "sol",
          tokenMint: "",
          amountWon: 0,
          timestamp: timestamp || Math.floor(Date.now() / 1000)
        };
        sendDiscordNotification(conn, fallbackEv, sig, slug).catch(err => {
          console.error("[Discord Webhook] Async send fallback failed:", err);
        });
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

      if (isSupabaseConfigured) {
        const { error: upsertErr } = await supabase
          .from("leaderboard")
          .upsert(recordsToInsert, { onConflict: "sig", ignoreDuplicates: true });

        if (upsertErr) {
          return NextResponse.json({ error: upsertErr.message }, { status: 500 });
        }
      } else {
        const LEADERBOARD_FILE = path.join(process.cwd(), "src/lib/leaderboard_db.json");
        try {
          let currentRecords: any[] = [];
          if (fs.existsSync(LEADERBOARD_FILE)) {
            currentRecords = JSON.parse(fs.readFileSync(LEADERBOARD_FILE, "utf-8"));
          }
          for (const newRec of recordsToInsert) {
            if (!currentRecords.some((r: any) => r.sig === newRec.sig)) {
              currentRecords.push({
                slug: newRec.slug,
                sig: newRec.sig,
                user: newRec.user,
                boxConfig: newRec.box_config,
                timestamp: newRec.timestamp,
                isSolBox: newRec.is_sol_box
              });
            }
          }
          fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(currentRecords, null, 2), "utf-8");
        } catch (fileErr) {
          console.error("[Leaderboard File] Failed to write local leaderboard:", fileErr);
        }
      }

      return NextResponse.json({ success: true });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
