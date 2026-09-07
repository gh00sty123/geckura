import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1526660578867675156/QKVdqrV2dw-ZsCQhQX-mIL_7I-9lAMl4g5eh9THUkQJJZbSCuk-HjioishNkzJCewlpf";
const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || "CXX3hFgqL5bozH8pYbTtetMHVYWkHwcx46MwHeF7VVcv");
const RPC = "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f";
const SLUG = "geckura";

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const idlPath = path.join(process.cwd(), "src/lib/idl.json");
  const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const coder = new BorshAccountsCoder(IDL as any);

  const [projectPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("project"), Buffer.from(SLUG)],
    PROGRAM_ID
  );

  console.log(`Project PDA for '${SLUG}': ${projectPda.toBase58()}`);

  const accounts = await conn.getProgramAccounts(PROGRAM_ID);
  console.log(`Total accounts for program: ${accounts.length}`);

  let soldOutCount = 0;

  for (const { pubkey, account } of accounts) {
    try {
      const decoded = coder.decode("BoxConfig", account.data);
      if (decoded && decoded.project?.toBase58() === projectPda.toBase58()) {
        const name = decoded.name || "Mystery Box";
        const sold = Number(decoded.sold ?? 0);
        const supply = Number(decoded.supply ?? 0);

        console.log(`\nBox found: ${name} (${pubkey.toBase58()})`);
        console.log(`  Sold: ${sold} / ${supply}`);

        if (supply > 0 && sold >= supply) {
          soldOutCount++;
          console.log(`  🔥 Box is SOLD OUT! Sending Discord Announcement...`);

          const embed = {
            title: "🔥 BOX SOLD OUT! 📦",
            url: `https://mysterybox.geckura.app/${SLUG}`,
            description: `🎉 **The "${name}" box for Geckura is now 100% SOLD OUT!**\n\n📦 **Total Supply:** **${sold} / ${supply}** claimed!\n\nThank you to everyone who participated! 🚀`,
            color: 15158332,
            timestamp: new Date().toISOString(),
            footer: { text: `Geckura Sold Out Announcement` }
          };

          const res = await fetch(DISCORD_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: "Geckura Draws",
              embeds: [embed]
            })
          });

          if (res.ok) {
            console.log(`  ✅ Successfully posted Sold Out alert for "${name}"!`);
          } else {
            console.error(`  ❌ Failed to post webhook:`, await res.text());
          }
        }
      }
    } catch {}
  }

  console.log(`\nDone! Total Sold-Out notifications sent: ${soldOutCount}`);
}

main().catch(console.error);
