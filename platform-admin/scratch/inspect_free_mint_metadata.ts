import { Connection, PublicKey } from "@solana/web3.js";
// @ts-ignore
import fetch from "node-fetch";

const RPC = "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f";
const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const MINTS = [
  "8734tKb8YZsyKDbnws4vQTWeoNbXmP4vcoG1S2hGzY3m",
  "5xUbTjhVW3PDVSrHar2i5CKFEjjP5NFSNheTmmZNSHtQ"
];

function parseMetaplexMetadata(data: Buffer | Uint8Array) {
  try {
    if (data.length < 319) return null;
    const nameBytes = data.slice(69, 69 + 32);
    const name = new TextDecoder().decode(nameBytes).replace(/\0/g, "").trim();
    const symbolBytes = data.slice(105, 105 + 10);
    const symbol = new TextDecoder().decode(symbolBytes).replace(/\0/g, "").trim();
    const uriBytes = data.slice(119, 119 + 200);
    let uri = new TextDecoder().decode(uriBytes).replace(/\0/g, "").trim();
    const httpIdx = uri.indexOf("http");
    if (httpIdx >= 0) uri = uri.slice(httpIdx);
    return { name, symbol, uri };
  } catch (e) {
    return null;
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  for (const m of MINTS) {
    console.log(`\nInspecting mint: ${m}`);
    const mintPk = new PublicKey(m);
    const [metaPk] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
      METAPLEX_PROGRAM_ID
    );
    const acc = await conn.getAccountInfo(metaPk);
    if (!acc) {
      console.log("  No Metaplex metadata PDA found.");
      continue;
    }
    const meta = parseMetaplexMetadata(acc.data);
    console.log("  Parsed Metadata:", meta);
    if (meta?.uri) {
      try {
        const res = await fetch(meta.uri);
        const json = await res.json();
        console.log("  Metadata JSON:", JSON.stringify(json, null, 2));
      } catch (err: any) {
        console.error("  Failed to fetch URI JSON:", err.message);
      }
    }
  }
}

main().catch(console.error);
