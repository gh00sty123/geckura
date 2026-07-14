import { Connection, PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("CXX3hFgqL5bozH8pYbTtetMHVYWkHwcx46MwHeF7VVcv");
const RPC = "https://devnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f";

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const idlPath = path.join(__dirname, "../src/lib/idl.json");
  const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const coder = new BorshAccountsCoder(IDL as any);
  
  const accounts = await conn.getProgramAccounts(PROGRAM_ID);
  console.log(`Found ${accounts.length} total program accounts on Devnet.\n`);

  console.log("--- PROJECTS ---");
  for (const { pubkey, account } of accounts) {
    try {
      const type = coder.decode("Project", account.data);
      if (type) {
        console.log(`Project Pubkey: ${pubkey.toBase58()}`);
        console.log(`  Slug: "${type.slug}"`);
        console.log(`  Name: "${type.name}"`);
        console.log(`  Is Active: ${type.isActive ?? type.is_active}`);
      }
    } catch (e) {
      // ignore
    }
  }

  console.log("\n--- BOX CONFIGS ---");
  for (const { pubkey, account } of accounts) {
    try {
      const type = coder.decode("BoxConfig", account.data);
      if (type) {
        console.log(`Box Config Pubkey: ${pubkey.toBase58()}`);
        console.log(`  Project: ${type.project.toBase58()}`);
        console.log(`  Box ID: ${type.boxId?.toNumber?.() ?? type.box_id?.toNumber?.() ?? type.boxId ?? type.box_id}`);
        console.log(`  Name: "${type.name}"`);
        console.log(`  Supply: ${type.supply}`);
        console.log(`  Sold: ${type.sold}`);
        console.log(`  Price Lamports: ${type.priceLamports?.toString() ?? type.price_lamports?.toString()}`);
      }
    } catch {}
  }
}

main().catch(console.error);
