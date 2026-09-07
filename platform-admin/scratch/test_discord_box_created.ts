export {};

const DISCORD_WEBHOOK_URL: string = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1526660578867675156/QKVdqrV2dw-ZsCQhQX-mIL_7I-9lAMl4g5eh9THUkQJJZbSCuk-HjioishNkzJCewlpf";

async function testBoxCreatedAlert() {
  console.log("Testing Discord Box Created Webhook Alert...");

  const projectName = "Geckura";
  const slug = "geckura";
  const boxName = "Geckura Platinum Treasure Box";
  const supplyText = "100 Boxes";
  const priceText = "0.05 SOL";
  const description = "Contains exclusive SOL rewards, $GAURA tokens, and rare NFTs!";
  const siteBaseUrl = "https://mysterybox.geckura.app";
  const boxSiteUrl = `${siteBaseUrl}/${slug}`;
  const validLogo = "https://gateway.irys.xyz/6-zHeDEpHIOc_nbiMzOykATzSEZp4jkT369BIQigRMo";
  const validBanner = "https://i.imgur.com/8QO2HkQ.png";

  const descriptionLines = [
    `🎉 **A brand new Mystery Box is now LIVE for ${projectName}!**\n`,
    `📦 **Box Name:** **${boxName}**`,
    `📊 **Total Supply:** **${supplyText}**`,
    `💰 **Mint Price:** **${priceText}**`,
    `📝 **Description:** ${description}`,
    `🎁 **Configured Rewards:** **4 Reward Items**`,
    `\n🎰 **Try Your Luck:** [Open ${boxName} Box Now!](${boxSiteUrl})`
  ];

  const embed = {
    title: `📦 NEW MYSTERY BOX CREATED! 🎁`,
    url: boxSiteUrl,
    description: descriptionLines.join("\n"),
    color: 3066993, // Green
    thumbnail: { url: validLogo },
    image: { url: validBanner },
    timestamp: new Date().toISOString(),
    footer: {
      text: `${projectName} Mystery Box Alert`,
      icon_url: validLogo
    },
    author: {
      name: projectName,
      url: boxSiteUrl,
      icon_url: validLogo
    }
  };

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `${projectName} Boxes`,
      avatar_url: validLogo,
      embeds: [embed]
    })
  });

  if (res.ok) {
    console.log("✅ Box Created Notification successfully sent to Discord!");
  } else {
    console.error("❌ Failed to send Box Created notification:", await res.text());
  }
}

testBoxCreatedAlert().catch(console.error);
