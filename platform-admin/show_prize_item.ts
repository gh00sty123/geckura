import { Connection, PublicKey } from "@solana/web3.js";

const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const PROGRAM = new PublicKey("3UsFkjHEJF37odV39hMcPcR6w7ifAC5KVRh6MzMpRQ3Z");

const PK = new PublicKey("6MnRFaauZeWbmJVpi7sZE5qJVp5Vys2Xpzvzm6UrUQQd");

async function main() {
  const info = await conn.getAccountInfo(PK, "confirmed");
  if (!info) { console.log("prize_item: MISSING"); return; }
  console.log("prize_item owner:", info.owner.equals(PROGRAM) ? "mystery_box ✓" : info.owner.toBase58().slice(0,8) + " ✗");
  console.log("prize_item lamports:", info.lamports);
  console.log("prize_item data:", info.data.length, "bytes");
  const hex = Buffer.from(info.data).toString("hex");
  console.log("disc (1-8):", hex.slice(0, 16));
  console.log("boxConfig Pubkey:", hex.slice(16, 80));
  console.log("index | prizeType | mint | amount | win% | total | claimed | bump:");
  console.log("  index:", hex.slice(80, 82));
  console.log("  prizeType:", hex.slice(82, 84));
  console.log("  mint:", hex.slice(84, 148));
  const amt = BigInt("0x" + hex.slice(148, 164));
  console.log("  amount:", amt.toString());
  console.log("  win%:", parseInt(hex.slice(164,166), 16));
  console.log("  total:", parseInt(hex.slice(166,174), 16));
  console.log("  claimed:", parseInt(hex.slice(174,182), 16));
}
main().catch(console.error);
