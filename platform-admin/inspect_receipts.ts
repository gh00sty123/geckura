import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");

const NETWORKS = [
  { name: "Devnet (Helius)", url: "https://devnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f" },
  { name: "Devnet (Public)", url: "https://api.devnet.solana.com" },
  { name: "Mainnet (Helius)", url: "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f" },
  { name: "Mainnet (Public)", url: "https://api.mainnet-beta.solana.com" }
];

async function scanNetwork(net: typeof NETWORKS[0]) {
  console.log(`\n=== Scanning ${net.name} (${net.url}) ===`);
  const conn = new Connection(net.url, "confirmed");
  const idlPath = path.join(process.cwd(), "src/lib/idl.json");
  const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const coder = new BorshAccountsCoder(IDL as any);

  try {
    const accounts = await conn.getProgramAccounts(PROGRAM_ID);
    console.log(`Found ${accounts.length} total program accounts.`);
    
    let foundReceipt = false;
    for (const { pubkey, account } of accounts) {
      try {
        const decoded = coder.decode("BoxReceipt", account.data);
        if (decoded) {
          const pending = decoded.pendingOpens ?? decoded.pending_opens ?? 0;
          const user = decoded.user?.toBase58?.() || String(decoded.user);
          const boxConfig = decoded.boxConfig?.toBase58?.() || decoded.box_config?.toBase58?.() || String(decoded.boxConfig ?? decoded.box_config);
          const purchased = decoded.purchased ?? 0;
          const totalOpened = decoded.totalOpened ?? decoded.total_opened ?? 0;
          const requestSlot = decoded.requestSlot ?? decoded.request_slot ?? 0;

          console.log(`BoxReceipt: ${pubkey.toBase58()}`);
          console.log(`  User: ${user}`);
          console.log(`  BoxConfig: ${boxConfig}`);
          console.log(`  Purchased: ${purchased}`);
          console.log(`  Total Opened: ${totalOpened}`);
          console.log(`  Pending Opens: ${pending}`);
          console.log(`  Request Slot: ${requestSlot}`);
          
          if (pending > 0) {
            console.log(`  >>> PENDING REVEAL DETECTED! <<<`);
          }
          foundReceipt = true;
        }
      } catch (err) {
        // Not a BoxReceipt, skip
      }
    }
    if (!foundReceipt) {
      console.log("No BoxReceipt accounts found.");
    }
  } catch (err: any) {
    console.error(`Error scanning ${net.name}:`, err.message || err);
  }
}

async function main() {
  for (const net of NETWORKS) {
    await scanNetwork(net);
  }
}

main().catch(console.error);
