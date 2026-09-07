import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1526660578867675156/QKVdqrV2dw-ZsCQhQX-mIL_7I-9lAMl4g5eh9THUkQJJZbSCuk-HjioishNkzJCewlpf";
const SITE_URL = "https://mysterybox.geckura.app/geckura";
const GECKURA_LOGO = "https://mysterybox.geckura.app/geckura-logo.jpg";

const PROGRAM_IDS = [
  new PublicKey("CXX3hFgqL5bozH8pYbTtetMHVYWkHwcx46MwHeF7VVcv"),
  new PublicKey("AEQrvbZvGwGcat5FXDXXZD71NiQsWNfdxvDFvdigxL5t"),
  new PublicKey("DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4")
];

const NETWORKS = [
  { name: "Devnet", url: "https://devnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f" },
  { name: "Mainnet", url: "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f" }
];

function formatNumberWithCommas(num: number): string {
  if (Number.isInteger(num)) {
    return num.toLocaleString("en-US");
  }
  return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function resolvePrizeDetails(mint: string, rawAmount: any, prizeTypeRaw: any) {
  const amountNum = Number(rawAmount ?? 0);
  const mintStr = mint || "";

  // Geckura $GAURA Token (5xUbTjh...)
  if (mintStr.startsWith("5xUbTjh")) {
    const divided = amountNum >= 1000000 ? amountNum / 1e6 : amountNum;
    return {
      assetName: "$GAURA",
      amountStr: `${formatNumberWithCommas(divided)} $GAURA`,
      imageUrl: "https://gateway.irys.xyz/6-zHeDEpHIOc_nbiMzOykATzSEZp4jkT369BIQigRMo"
    };
  }

  // Geckura Free Mint Ticket (8734tKb8...)
  if (mintStr.startsWith("8734tKb8")) {
    const divided = amountNum >= 1000000 ? amountNum / 1e6 : amountNum;
    const ticketCount = divided > 0 ? divided : 1;
    return {
      assetName: "Geckura Free Mint",
      amountStr: `${formatNumberWithCommas(ticketCount)} Free Mint Ticket${ticketCount > 1 ? "s" : ""}`,
      imageUrl: "https://gateway.irys.xyz/YPWTFjbx1MQw3vfdgSCWi6Ki_0BTTpDK3UdW75sp63E"
    };
  }

  // Solana (SOL)
  if (!mint || mint === "11111111111111111111111111111111" || mint.startsWith("So111")) {
    const solVal = amountNum > 1e6 ? amountNum / 1e9 : amountNum;
    return {
      assetName: "Solana (SOL)",
      amountStr: `${solVal > 0 ? solVal.toFixed(4) : "0.5000"} SOL`,
      imageUrl: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
    };
  }

  // USDC
  if (mint === "EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v") {
    const usdcVal = amountNum > 1e4 ? amountNum / 1e6 : amountNum;
    return {
      assetName: "USDC",
      amountStr: `${formatNumberWithCommas(usdcVal)} USDC`,
      imageUrl: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2xzybapC8G4wEGGkZwyTDt1v/logo.png"
    };
  }

  const shortMint = `${mint.slice(0, 4)}...${mint.slice(-4)}`;
  const isNft = (typeof prizeTypeRaw === "object" && prizeTypeRaw?.nft) || prizeTypeRaw === 2;
  const assetName = isNft ? `NFT (${shortMint})` : `Token (${shortMint})`;
  const amountStr = isNft ? `1 ${assetName}` : `${formatNumberWithCommas(amountNum)} ${assetName}`;

  return {
    assetName,
    amountStr,
    imageUrl: GECKURA_LOGO
  };
}

async function broadcastToDiscord(event: {
  username: string;
  wallet: string;
  projectName: string;
  amountStr: string;
  sig: string;
  isWin: boolean;
  imageUrl?: string;
}) {
  const explorerUrl = `https://solscan.io/tx/${event.sig}`;
  const userExplorerUrl = `https://solscan.io/account/${event.wallet}`;
  const img = event.imageUrl || GECKURA_LOGO;

  const rewardText = event.isWin 
    ? `🏆 **Won:** **${event.amountStr}**` 
    : "🎁 **Mystery Box Opened**";

  const description = `
👤 **Player:** [${event.username}](${userExplorerUrl})
📦 **Project:** **${event.projectName}**
✨ **Result:** ${rewardText}

🔗 **Transaction:** [View on Solscan](${explorerUrl})
🎰 **Try Your Luck:** [Open a Box!](${SITE_URL})
  `.trim();

  const embed = {
    title: event.isWin ? "🎉 New Mystery Box Win!" : "🎁 Mystery Box Opened",
    url: SITE_URL,
    description,
    color: event.isWin ? 1878116 : 10070709,
    thumbnail: { url: img },
    image: { url: img },
    timestamp: new Date().toISOString(),
    footer: { text: `${event.projectName} Draw Alerts` }
  };

  console.log(`Posting to Discord [Geckura Draws]: ${event.username} - ${rewardText}`);

  let retries = 3;
  while (retries > 0) {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Geckura Draws",
        avatar_url: GECKURA_LOGO,
        embeds: [embed]
      })
    });

    if (res.ok) {
      console.log(`  ✅ Posted successfully!`);
      break;
    }

    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const waitMs = (body.retry_after ? body.retry_after * 1000 : 1500) + 300;
      console.warn(`  ⚠️ Rate limited. Waiting ${(waitMs / 1000).toFixed(2)}s before retry...`);
      await new Promise(r => setTimeout(r, waitMs));
      retries--;
    } else {
      console.error(`  ❌ Failed:`, await res.text());
      break;
    }
  }

  await new Promise(r => setTimeout(r, 600));
}

async function main() {
  const idlPath = path.join(process.cwd(), "src/lib/idl.json");
  const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const coder = new BorshAccountsCoder(IDL as any);

  let totalBroadcasted = 0;

  for (const net of NETWORKS) {
    const conn = new Connection(net.url, "confirmed");

    for (const pgId of PROGRAM_IDS) {
      try {
        const accounts = await conn.getProgramAccounts(pgId);

        for (const { pubkey, account } of accounts) {
          try {
            const decoded = coder.decode("BoxReceipt", account.data);
            if (decoded) {
              const user = decoded.user?.toBase58?.() || String(decoded.user);
              const totalOpened = Number(decoded.totalOpened ?? decoded.total_opened ?? 0);
              const purchased = Number(decoded.purchased ?? 0);
              const claimables = decoded.claimablePrizes ?? decoded.claimable_prizes ?? [];

              if (totalOpened > 0 || purchased > 0 || claimables.length > 0) {
                console.log(`\nFound BoxReceipt: ${pubkey.toBase58()} on ${net.name} (${pgId.toBase58()})`);
                console.log(`  User: ${user}, Opened: ${totalOpened}, Purchased: ${purchased}, Claimables: ${claimables.length}`);

                const username = `${user.slice(0, 6)}...${user.slice(-6)}`;
                
                if (claimables.length > 0) {
                  for (const prize of claimables) {
                    const rawAmount = prize.amount?.toString() || "1";
                    const mint = prize.tokenMint?.toBase58() ?? prize.token_mint?.toBase58() ?? "";
                    const prizeTypeRaw = prize.prizeType ?? prize.prize_type;

                    const details = resolvePrizeDetails(mint, rawAmount, prizeTypeRaw);

                    await broadcastToDiscord({
                      username,
                      wallet: user,
                      projectName: "Geckura",
                      amountStr: details.amountStr,
                      sig: pubkey.toBase58(),
                      isWin: true,
                      imageUrl: details.imageUrl
                    });
                    totalBroadcasted++;
                  }
                } else {
                  await broadcastToDiscord({
                    username,
                    wallet: user,
                    projectName: "Geckura",
                    amountStr: `${purchased || totalOpened || 1} Box(es)`,
                    sig: pubkey.toBase58(),
                    isWin: false,
                    imageUrl: GECKURA_LOGO
                  });
                  totalBroadcasted++;
                }
              }
            }
          } catch {}
        }
      } catch (err: any) {
        console.warn(`Could not query ${pgId.toBase58()} on ${net.name}:`, err.message || err);
      }
    }
  }

  // Also check local leaderboard JSON database
  const leaderboardFile = path.join(process.cwd(), "src/lib/leaderboard_db.json");
  if (fs.existsSync(leaderboardFile)) {
    const raw = JSON.parse(fs.readFileSync(leaderboardFile, "utf-8"));
    console.log(`\nFound ${raw.length} records in local leaderboard_db.json`);
    for (const rec of raw) {
      const username = rec.user ? `${rec.user.slice(0, 6)}...${rec.user.slice(-6)}` : "Player";
      const slugName = rec.slug ? rec.slug.toUpperCase() : "Geckura";
      await broadcastToDiscord({
        username,
        wallet: rec.user || "Unknown",
        projectName: slugName,
        amountStr: "0.5000 SOL",
        sig: rec.sig,
        isWin: true,
        imageUrl: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png"
      });
      totalBroadcasted++;
    }
  }

  console.log(`\nDone broadcasting! Total notifications sent: ${totalBroadcasted}`);
}

main().catch(console.error);
