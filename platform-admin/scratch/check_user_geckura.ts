import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const USER_PUBKEY = new PublicKey("8RPYCAauqp3kXNvrRxiPpnv4oyFqS9YaAxdzQR94PkGb");
const SLUG = "geckura";

const PROGRAM_IDS = [
  new PublicKey("AEQrvbZvGwGcat5FXDXXZD71NiQsWNfdxvDFvdigxL5t"),
  new PublicKey("CXX3hFgqL5bozH8pYbTtetMHVYWkHwcx46MwHeF7VVcv"),
  new PublicKey("DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4"),
];

const GECKURA_FREE_MINT = "8734tKb8YZsyKDbnws4vQTWeoNbXmP4vcoG1S2hGzY3m";

const NETWORKS = [
  { name: "Mainnet (Helius)", url: "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f" },
  { name: "Mainnet (Public)", url: "https://api.mainnet-beta.solana.com" },
  { name: "Devnet (Helius)", url: "https://devnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f" }
];

async function main() {
  const idlPath = path.join(process.cwd(), "src/lib/idl.json");
  const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const coder = new BorshAccountsCoder(IDL as any);

  for (const net of NETWORKS) {
    console.log(`\n==================================================`);
    console.log(`=== Scanning Network: ${net.name} ===`);
    console.log(`==================================================`);
    const conn = new Connection(net.url, "confirmed");

    const bal = await conn.getBalance(USER_PUBKEY);
    console.log(`User SOL Balance: ${bal / 1e9} SOL (${bal} lamports)`);

    for (const pgId of PROGRAM_IDS) {
      console.log(`\nChecking Program ID: ${pgId.toBase58()}`);

      const [projectPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("project"), Buffer.from(SLUG)],
        pgId
      );

      const [receiptPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), USER_PUBKEY.toBuffer(), projectPda.toBuffer()],
        pgId
      );

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), projectPda.toBuffer()],
        pgId
      );

      console.log(`  Project PDA: ${projectPda.toBase58()}`);
      console.log(`  Vault PDA: ${vaultPda.toBase58()}`);
      console.log(`  Receipt PDA: ${receiptPda.toBase58()}`);

      const accInfo = await conn.getAccountInfo(receiptPda);
      if (!accInfo) {
        console.log(`  -> Receipt account does NOT exist for this program ID.`);
        continue;
      }

      try {
        const decoded = coder.decode("BoxReceipt", accInfo.data);
        console.log(`  >>> FOUND RECEIPT ACCOUNT! <<<`);
        console.log(`    User: ${decoded.user.toBase58()}`);
        console.log(`    Total Opened: ${decoded.totalOpened ?? decoded.total_opened}`);
        console.log(`    Purchased: ${decoded.purchased}`);

        const claimable = decoded.claimablePrizes ?? decoded.claimable_prizes ?? [];
        console.log(`    Claimable Prizes Count: ${claimable.length}`);

        for (let i = 0; i < claimable.length; i++) {
          const prize = claimable[i];
          const mint = prize.tokenMint?.toBase58() ?? prize.token_mint?.toBase58() ?? "N/A";
          const prizeTypeRaw = JSON.stringify(prize.prizeType ?? prize.prize_type);
          const amount = prize.amount?.toString();

          console.log(`\n    [Prize #${i + 1}]`);
          console.log(`      Prize Type: ${prizeTypeRaw}`);
          console.log(`      Token Mint: ${mint}`);
          console.log(`      Amount Won (raw): ${amount}`);

          if (mint === GECKURA_FREE_MINT) {
            console.log(`      >>> RESULT: GECKURA FREE MINT (8734tKb8...) <<<`);
          } else if (mint.startsWith("5xUbTjh")) {
            console.log(`      >>> RESULT: GECKURA TOKEN (5xUbTjhV...) <<<`);
          } else if (prizeTypeRaw.includes("Sol") || prizeTypeRaw === '{"sol":{}}') {
            console.log(`      >>> RESULT: SOL PRIZE <<<`);
          }
        }
      } catch (e: any) {
        console.error(`  Error decoding receipt:`, e.message || e);
      }
    }
  }
}

main().catch(console.error);
