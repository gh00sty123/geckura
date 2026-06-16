import { Connection, PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccount } from "@solana/spl-token";

const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const kpRaw = require("fs").readFileSync(require("os").homedir() + "/.config/solana/id.json");
const kp = require("@solana/web3.js").Keypair.fromSecretKey(new Uint8Array(JSON.parse(kpRaw.toString())));
const mint = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  const owner = kp.publicKey;
  console.log("Calling createAssociatedTokenAccount:");
  console.log("  payer:", kp.publicKey.toBase58());
  console.log("  owner:", owner.toBase58());
  console.log("  mint: ", mint.toBase58());

  try {
    const atan = await createAssociatedTokenAccount(conn, kp, mint, owner, { skipPreflight: true, commitment: "confirmed" });
    console.log("Returned ATA:       ", atan.toBase58());

    const info = await conn.getAccountInfo(atan, "confirmed");
    console.log("On-chain owner:", info?.owner.toBase58());
    console.log("On-chain len:  ", info?.data.length);
    const hex = Buffer.from(info?.data || Buffer.alloc(0)).toString("hex");
    console.log("Data hex (80b):", hex.slice(0, 160));
  } catch(e: any) {
    console.error("ERROR:", e.message);
    if (e.logs) console.error("Logs:", e.logs.join(" / "));
    console.error(e.stack?.split("\n").slice(0,6).join("\n"));
  }
}
main().catch(console.error);
