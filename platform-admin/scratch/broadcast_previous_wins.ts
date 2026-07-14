const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const BOX_SITE_URL = "https://mysterybox.geckura.app/geckura";

const SOL_IMAGE = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";
const USDC_IMAGE = "https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=040";

async function main() {
  if (!DISCORD_WEBHOOK_URL) {
    console.error("DISCORD_WEBHOOK_URL not configured in environment.");
    return;
  }

  const demos = [
    {
      username: "GeckoGuru",
      wallet: "9aPcEhmHttS8ed4RBSeJSDExPtuKV2RV7BvtUPrkDMsi",
      sig: "5AWpASjTroAA9ryXug4qtDqoVbZ5ihbzgn7woG19J95DeryqUdt35rVbEqLtNCVaLJQoYLGXkPFvKEyLhovDjxdx",
      reward: "0.5000 SOL",
      rewardName: "Solana (SOL)",
      imageUrl: SOL_IMAGE,
    },
    {
      username: "CryptoKing",
      wallet: "DBDa3aYPiE7CeJLLRQWTJ8MRHnRuaEf5tQfeNug6P3G5",
      sig: "2Q4JT33rEmhX6H3RSjwhv5t8LgkDU4hn9faXZFxew6vchWqQBJnMmUJxK3xcTjzFQVN8TnRvJ5WUeVtj892SYhyr",
      reward: "25.00 USDC",
      rewardName: "USDC",
      imageUrl: USDC_IMAGE,
    },
  ];

  console.log(`Sending ${demos.length} demo win alerts to Discord...`);

  for (const demo of demos) {
    const explorerUrl = `https://solscan.io/tx/${demo.sig}`;
    const userExplorerUrl = `https://solscan.io/account/${demo.wallet}`;

    const description = `
👤 **Player:** [${demo.username}](${userExplorerUrl})
📦 **Project:** **Geckura**
✨ **Result:** 🏆 **Won: ${demo.reward}** of **${demo.rewardName}**

🔗 **Transaction:** [View on Solscan](${explorerUrl})
🎰 **Try Your Luck:** [Open a Box!](${BOX_SITE_URL})
    `.trim();

    const embed: any = {
      title: "🎉 New Mystery Box Win!",
      url: BOX_SITE_URL,
      description,
      color: 1878116, // #1cac64
      thumbnail: { url: demo.imageUrl },
      image: { url: demo.imageUrl },
      timestamp: new Date().toISOString(),
      footer: {
        text: "Geckura Draw Alerts"
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
      console.log(`✅ Sent: ${demo.username} won ${demo.reward}`);
    } else {
      console.error(`❌ Failed:`, await res.text());
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log("Done!");
}

main().catch(console.error);
