import { NextRequest } from "next/server";
import * as fs from "fs";

async function main() {
  // Load local Solana wallet as keeper keypair env
  const keyJson = fs.readFileSync("/home/faizan/.config/solana/id.json", "utf8");
  process.env.CRANK_PRIVATE_KEY = keyJson.trim();
  process.env.NEXT_PUBLIC_RPC_URL = "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f";

  console.log("CRANK_PRIVATE_KEY set.");
  
  // Log keeper public key and mainnet balance
  const { Keypair, Connection } = require("@solana/web3.js");
  const keeperKp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(process.env.CRANK_PRIVATE_KEY)));
  const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL, "confirmed");
  const balance = await conn.getBalance(keeperKp.publicKey);
  console.log(`Keeper Public Key: ${keeperKp.publicKey.toBase58()}`);
  console.log(`Keeper Balance: ${balance / 1e9} SOL`);

  // Dynamically import POST so env overrides are applied during its module-level initialization
  const { POST } = await import("./src/app/api/reveal/route");

  // Construct NextRequest
  const req = new NextRequest("http://localhost/api/reveal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      slug: "geckura",
      boxId: 0,
      receipt: "8P1eibPXqLqYjd9XnYaLEZcTtb9PqcJfWGeuWB1X39o"
    })
  });

  console.log("Invoking POST /api/reveal...");
  try {
    const res = await POST(req);
    console.log("Response status:", res.status);
    const body = await res.json();
    console.log("Response body:", JSON.stringify(body, null, 2));
  } catch (err) {
    console.error("Caught error invoking POST:", err);
  }
}

main();
