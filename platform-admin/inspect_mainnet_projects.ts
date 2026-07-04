import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("DVCAjYv1EH5T2RcVN1t3BYVahfW1h4UJXhgDdY8oQes4");
const RPC = "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f";

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const idlPath = path.join(process.cwd(), "src/lib/idl.json");
  const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const coder = new BorshAccountsCoder(IDL as any);
  
  const accounts = await conn.getProgramAccounts(PROGRAM_ID);
  console.log(`Found ${accounts.length} total program accounts on Mainnet.\n`);

  console.log("--- PROJECTS ---");
  for (const { pubkey, account } of accounts) {
    try {
      const type = coder.decode("Project", account.data);
      if (type) {
        console.log(`Project: ${pubkey.toBase58()}`);
        console.log(`  Slug: ${type.slug}`);
        console.log(`  Authority: ${type.authority.toBase58()}`);
        console.log(`  Fee Wallet: ${type.feeWallet.toBase58()}`);
        console.log(`  Fee Lamports: ${type.feeLamports}`);
      }
    } catch {}
  }

  console.log("\n--- BOX CONFIGS ---");
  for (const { pubkey, account } of accounts) {
    try {
      const type = coder.decode("BoxConfig", account.data);
      if (type) {
        console.log(`Box Config: ${pubkey.toBase58()}`);
        console.log(`  Project: ${type.project.toBase58()}`);
        console.log(`  Box ID: ${type.boxId ?? type.box_id}`);
        console.log(`  Supply: ${type.supply}`);
        console.log(`  Sold: ${type.sold}`);
        console.log(`  Total Opened: ${type.totalOpened ?? type.total_opened}`);
      }
    } catch {}
  }

  console.log("\n--- PRIZE ITEMS ---");
  for (const { pubkey, account } of accounts) {
    try {
      const type = coder.decode("PrizeItem", account.data);
      if (type) {
        console.log(`Prize Item: ${pubkey.toBase58()}`);
        console.log(`  Box Config: ${type.boxConfig?.toBase58() ?? type.box_config?.toBase58()}`);
        console.log(`  Index: ${type.index}`);
        console.log(`  Type: ${JSON.stringify(type.prizeType ?? type.prize_type)}`);
        console.log(`  Mint: ${type.tokenMint?.toBase58() ?? type.token_mint?.toBase58()}`);
        console.log(`  Win %: ${type.winPercentage ?? type.win_percentage}`);
        console.log(`  Amount: ${type.amount?.toString()}`);
        console.log(`  Total: ${type.totalCount ?? type.total_count}`);
        console.log(`  Claimed: ${type.claimedCount ?? type.claimed_count}`);
      }
    } catch {}
  }

  console.log("\n--- BOX RECEIPTS ---");
  for (const { pubkey, account } of accounts) {
    try {
      const type = coder.decode("BoxReceipt", account.data);
      if (type) {
        console.log(`Box Receipt: ${pubkey.toBase58()}`);
        console.log(`  User: ${type.user.toBase58()}`);
        console.log(`  Box Config: ${type.boxConfig?.toBase58() ?? type.box_config?.toBase58()}`);
        console.log(`  Pending Opens: ${type.pendingOpens ?? type.pending_opens}`);
      }
    } catch {}
  }
}

main().catch(console.error);
