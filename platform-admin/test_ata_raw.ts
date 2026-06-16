import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");

// Load keypair
const kpRawBuf = require("fs").readFileSync(require("os").homedir() + "/.config/solana/id.json");
const secret = new Uint8Array(JSON.parse(kpRawBuf.toString()));
const { Keypair } = require("@solana/web3.js");
const kp = Keypair.fromSecretKey(secret);
const mint = new PublicKey("So11111111111111111111111111111111111111112");

async function main() {
  // Derive the ATA deterministically
  const ata = getAssociatedTokenAddressSync(mint, kp.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  console.log("ATA addr:", ata.toBase58());

  // Build raw create_associated_token_account instruction
  const SYS_PROGRAM = new PublicKey("11111111111111111111111111111111");
  const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

  const keys = [
    { pubkey: kp.publicKey,              isSigner: true,  isWritable: true  },
    { pubkey: ata,                       isSigner: false, isWritable: true  },
    { pubkey: kp.publicKey,              isSigner: false, isWritable: false },
    { pubkey: mint,                      isSigner: false, isWritable: false },
    { pubkey: SYS_PROGRAM,               isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID,          isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: ATA_PROGRAM,
    data: Buffer.from([]),     // empty data = Create variant
  });

  console.log("Build TX...");
  const bh = (await conn.getLatestBlockhash()).blockhash;
  const tx = new Transaction().add(ix);
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = bh;
  tx.sign(kp);
  const raw = tx.serialize();

  try {
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, preflightCommitment: "confirmed" });
    console.log("sig:", sig);
    await conn.confirmTransaction(sig, "confirmed");
    console.log("CONFIRMED");
    const info = await conn.getAccountInfo(ata, "confirmed");
    console.log("ATA owner:", info?.owner.toBase58());
    console.log("ATA data:", info?.data.length, "B");
  } catch (e: any) {
    console.error("ERROR:", e?.message || String(e));
    if (e?.logs) console.error("LOGS:", e.logs.join("\n"));
    if (e?.stack) console.error(e.stack.split("\n").slice(0, 5).join("\n"));
  }
}
main().catch(console.error);
