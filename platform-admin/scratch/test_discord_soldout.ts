import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1526660578867675156/QKVdqrV2dw-ZsCQhQX-mIL_7I-9lAMl4g5eh9THUkQJJZbSCuk-HjioishNkzJCewlpf";

async function testSoldOutAlert() {
  console.log("Testing Discord Box Sold Out Webhook...");

  const embed = {
    title: "🔥 BOX SOLD OUT! 📦",
    url: "https://mysterybox.geckura.app/geckura",
    description: `🎉 **The "Geckura Legend Box" box for Geckura is now 100% SOLD OUT!**\n\n📦 **Total Supply:** **500 / 500** claimed!\n\nThank you to everyone who participated! 🚀`,
    color: 15158332,
    timestamp: new Date().toISOString(),
    footer: {
      text: "Geckura Sold Out Announcement"
    }
  };

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Geckura Draw Bot",
      embeds: [embed]
    })
  });

  if (res.ok) {
    console.log("✅ Sold Out Notification successfully sent to Discord!");
  } else {
    console.error("❌ Failed to send Sold Out notification:", await res.text());
  }
}

testSoldOutAlert().catch(console.error);
