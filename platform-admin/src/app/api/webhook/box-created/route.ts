import { NextRequest, NextResponse } from "next/server";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

const DEFAULT_DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1526660578867675156/QKVdqrV2dw-ZsCQhQX-mIL_7I-9lAMl4g5eh9THUkQJJZbSCuk-HjioishNkzJCewlpf";

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      slug,
      boxId,
      name,
      description,
      bannerUri,
      supply,
      priceLamports,
      prizes,
    } = body;

    if (!slug || !name) {
      return NextResponse.json({ error: "Missing required parameters: slug and name" }, { status: 400 });
    }

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
        console.error("[BoxCreated Webhook API] Error fetching project branding:", dbErr);
      }
    }

    const targetWebhookUrl = projectWebhookUrl || process.env.DISCORD_WEBHOOK_URL || DEFAULT_DISCORD_WEBHOOK_URL;
    if (!targetWebhookUrl) {
      return NextResponse.json({ error: "No Discord webhook URL configured" }, { status: 500 });
    }

    const siteBaseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://mysterybox.geckura.app";
    const boxSiteUrl = `${siteBaseUrl}/${slug}`;

    const validLogo = (logoUri && typeof logoUri === "string" && logoUri.startsWith("http")) ? logoUri : undefined;
    let validBanner = bannerUri ? resolveIpfsUrl(bannerUri) : undefined;
    if (validBanner && !validBanner.startsWith("http")) validBanner = undefined;

    const numSupply = Number(supply) || 0;
    const supplyText = numSupply > 0 ? `${numSupply.toLocaleString()} Boxes` : "Unlimited";

    const lamports = Number(priceLamports) || 0;
    const priceSol = lamports > 0 ? (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
    const priceText = lamports > 0 ? `${priceSol} SOL` : "Free / Multi-currency";

    let embedColor = 3066993; // Default green #1cac64
    if (themeColorHex) {
      const cleanHex = themeColorHex.replace("#", "");
      const num = parseInt(cleanHex, 16);
      if (!isNaN(num)) embedColor = num;
    }

    const descriptionLines = [
      `🎉 **A brand new Mystery Box is now LIVE for ${projectName}!**\n`,
      `📦 **Box Name:** **${name}**`,
      `📊 **Total Supply:** **${supplyText}**`,
      `💰 **Mint Price:** **${priceText}**`
    ];

    if (description) {
      descriptionLines.push(`📝 **Description:** ${description}`);
    }

    if (Array.isArray(prizes) && prizes.length > 0) {
      const prizesCount = prizes.length;
      descriptionLines.push(`🎁 **Configured Rewards:** **${prizesCount} Reward Item${prizesCount > 1 ? "s" : ""}**`);
    }

    descriptionLines.push(`\n🎰 **Try Your Luck:** [Open ${name} Box Now!](${boxSiteUrl})`);

    const defaultImage = "https://i.imgur.com/8QO2HkQ.png";
    const thumbUrl = validBanner || validLogo || defaultImage;

    const embed: any = {
      title: `📦 NEW MYSTERY BOX CREATED! 🎁`,
      url: boxSiteUrl,
      description: descriptionLines.join("\n"),
      color: embedColor,
      thumbnail: { url: thumbUrl },
      timestamp: new Date().toISOString(),
      footer: {
        text: `${projectName} Mystery Box Alert`,
        icon_url: validLogo
      }
    };

    if (validBanner) {
      embed.image = { url: validBanner };
    }

    if (validLogo) {
      embed.author = {
        name: projectName,
        url: boxSiteUrl,
        icon_url: validLogo
      };
    }

    const discordResponse = await fetch(targetWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: discordRoleId ? `<@&${discordRoleId}>` : undefined,
        username: `${projectName} Boxes`,
        avatar_url: validLogo,
        embeds: [embed]
      })
    });

    if (!discordResponse.ok) {
      const errText = await discordResponse.text();
      console.error("[BoxCreated Webhook API] Discord returned error:", errText);
      return NextResponse.json({ error: "Failed to post to Discord webhook", details: errText }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: "Box creation alert sent to webhook successfully." });
  } catch (err: any) {
    console.error("[BoxCreated Webhook API] Error:", err);
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
