import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const USER_PUBKEY_STR = "8RPYCAauqp3kXNvrRxiPpnv4oyFqS9YaAxdzQR94PkGb";

const NETWORKS = [
  { name: "Mainnet (Helius)", url: "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f" },
  { name: "Devnet (Helius)", url: "https://devnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f" },
];

async function inspectUserOnNetwork(net: typeof NETWORKS[0]) {
  console.log(`\n========================================`);
  console.log(`=== Inspecting ${net.name} ===`);
  console.log(`========================================`);
  const conn = new Connection(net.url, "confirmed");
  const userPk = new PublicKey(USER_PUBKEY_STR);

  const bal = await conn.getBalance(userPk);
  console.log(`User SOL Balance: ${bal / 1e9} SOL (${bal} lamports)`);

  const idlPath = path.join(__dirname, "../src/lib/idl.json");
  const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const coder = new BorshAccountsCoder(IDL as any);

  // Check all program accounts
  const programId = new PublicKey("DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
  const accounts = await conn.getProgramAccounts(programId);
  console.log(`Total program accounts on ${net.name}: ${accounts.length}`);

  for (const { pubkey, account } of accounts) {
    try {
      const decoded = coder.decode("BoxReceipt", account.data);
      if (decoded && decoded.user.toBase58() === USER_PUBKEY_STR) {
        console.log(`\nFound BoxReceipt for user: ${pubkey.toBase58()}`);
        console.log(`  Project: ${decoded.project.toBase58()}`);
        console.log(`  Purchased: ${decoded.purchased}`);
        console.log(`  Total Opened: ${decoded.totalOpened ?? decoded.total_opened}`);
        console.log(`  Nonce: ${decoded.nonce}`);
        console.log(`  Claimable Prizes Count: ${decoded.claimablePrizes?.length ?? decoded.claimable_prizes?.length ?? 0}`);
        
        const prizes = decoded.claimablePrizes ?? decoded.claimable_prizes ?? [];
        for (let i = 0; i < prizes.length; i++) {
          const p = prizes[i];
          console.log(`   Prize #${i+1}:`);
          console.log(`     BoxConfig: ${p.boxConfig?.toBase58() ?? p.box_config?.toBase58()}`);
          console.log(`     PrizeIndex: ${p.prizeIndex ?? p.prize_index}`);
          console.log(`     PrizeType: ${JSON.stringify(p.prizeType ?? p.prize_type)}`);
          console.log(`     TokenMint: ${p.tokenMint?.toBase58() ?? p.token_mint?.toBase58()}`);
          console.log(`     Amount: ${p.amount?.toString()}`);
        }
      }
    } catch {}
  }
}

async function main() {
  for (const net of NETWORKS) {
    await inspectUserOnNetwork(net);
  }
}

main().catch(console.error);
