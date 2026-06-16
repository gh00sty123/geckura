import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const RPC = "https://devnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f";
const PGID = new PublicKey("DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const idlPath = path.join(process.cwd(), "src/lib/idl.json");
  const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  
  const accounts = await conn.getProgramAccounts(PGID);
  const coder = new BorshAccountsCoder(IDL as any);
  
  console.log("--- All Box Configs ---");
  for (const { pubkey, account } of accounts) {
    try {
      const type = coder.decode("BoxConfig", account.data);
      if (type) {
        console.log(`Box Config: ${pubkey.toBase58()}`);
        console.log(`  Project: ${type.project.toBase58()}`);
        console.log(`  ID: ${type.boxId ?? type.box_id}`);
        console.log(`  Supply: ${type.supply}`);
        console.log(`  Sold: ${type.sold}`);
        console.log(`  Total Opened: ${type.totalOpened ?? type.total_opened}`);
      }
    } catch (err: any) {
      console.error(`Error decoding BoxConfig ${pubkey.toBase58()}:`, err);
    }
  }

  console.log("\n--- All Prize Items ---");
  for (const { pubkey, account } of accounts) {
    try {
      const prize = coder.decode("PrizeItem", account.data);
      if (prize) {
        const typeRaw = prize.prizeType ?? prize.prize_type;
        const mintRaw = prize.tokenMint ?? prize.token_mint;
        const totalRaw = prize.totalCount ?? prize.total_count;
        const claimedRaw = prize.claimedCount ?? prize.claimed_count;
        const winRaw = prize.winPercentage ?? prize.win_percentage;
        
        console.log(`Prize Item: ${pubkey.toBase58()}`);
        console.log(`  Box Config: ${prize.boxConfig?.toBase58() ?? prize.box_config?.toBase58()}`);
        console.log(`  Index: ${prize.index}`);
        console.log(`  Type: ${JSON.stringify(typeRaw)}`);
        console.log(`  Mint: ${mintRaw?.toBase58()}`);
        console.log(`  Amount: ${prize.amount?.toString()}`);
        console.log(`  Win %: ${winRaw}`);
        console.log(`  Total Count: ${totalRaw}`);
        console.log(`  Claimed Count: ${claimedRaw}`);
      }
    } catch (err: any) {
      console.error(`Error decoding PrizeItem ${pubkey.toBase58()}:`, err);
    }
  }
}

main().catch(console.error);
