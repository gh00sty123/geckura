import { Connection, PublicKey } from "@solana/web3.js";

const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const ATAN_ADDR = new PublicKey("CMvrP9PBgmryj55gYozGhH5Du8mx5bA54dfGmW2VQ9wR");
const ATAN_ADDR2 = new PublicKey("DVZPXLAxneiziGh3CYWkYuSAbXcznqxzXX6c85hzGPVU");

async function main() {
  for (const [label, pk] of [["tenant_ata", ATAN_ADDR], ["vault_ata", ATAN_ADDR2]]) {
    const acc = await conn.getAccountInfo(pk, "confirmed");
    if (!acc) { console.log(label, "MISSING"); continue; }
    console.log(label, "owner:", acc.owner.toBase58());
    console.log(label, "lamports:", acc.lamports);
    console.log(label, "executable:", acc.executable);
    console.log(label, "data:", acc.data.length, "B");
    const hex = Buffer.from(acc.data).toString("hex");
    console.log(label, "disc:", hex.slice(0, 16));
    console.log(label, "mint:", hex.slice(16, 80));
    console.log(label, "amount:", BigInt("0x" + hex.slice(80, 96)).toString());
    console.log(label, "delegate:", hex.slice(96, 160));
    console.log(label, "state:", parseInt(hex.slice(160,162), 16));
    console.log("---");
  }
}
main().catch(console.error);
