import { Connection, PublicKey, Transaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, NATIVE_MINT, createInitializeAccountInstruction } from "@solana/spl-token";
import { AccountLayout, getAccountLayout } from "@solana/spl-token";

const SYSVAR_RENT   = new PublicKey("SysvarRent111111111111111111111111111111111");

const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const kpRawBuf = require("fs").readFileSync(require("os").homedir() + "/.config/solana/id.json");
const { Keypair } = require("@solana/web3.js");
const kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(kpRawBuf.toString())));
const mint = NATIVE_MINT; // So11111111111111111111111111111111111111112

async function main() {
  // Derive associated token account address for native mint (off-curve owner via allowOffCurve)
  const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
  const ata = getAssociatedTokenAddressSync(mint, kp.publicKey, true, TOKEN_PROGRAM_ID);
  console.log("ATA:", ata.toBase58());

  // Call create_associated_token_account on raw raw SPL-ATA
  console.log("Rent:", await conn.getMinimumBalanceForRentExemption(0));
  const SYS_PROG  = new PublicKey("11111111111111111111111111111111");
  const ATA_PROG  = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

  const keys = [
    { pubkey: kp.publicKey,   isSigner: true,  isWritable: true  }, // payer
    { pubkey: ata,            isSigner: false, isWritable: true  }, // ATA (to be created)
    { pubkey: kp.publicKey,   isSigner: false, isWritable: false }, // owner
    { pubkey: mint,           isSigner: false, isWritable: false }, // token mint
    { pubkey: SYS_PROG,       isSigner: false, isWritable: false }, // system_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
  ];

  // create ix
  const createIx = new TransactionInstruction({
    keys,
    programId: ATA_PROG,
    data: Buffer.alloc(0),
  });

  // init ix
  const initIx = createInitializeAccountInstruction(ata, mint, kp.publicKey, TOKEN_PROGRAM_ID);

  // sync_native ix
  const syncNativeData = Buffer.from([17]);
  const syncKeys = [
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
  ];
  const syncIx = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    data: syncNativeData,
    keys: syncKeys,
  });

  const bh = (await conn.getLatestBlockhash()).blockhash;
  const tx = new Transaction()
    .add(createIx)
    .add(initIx)
    .add(syncIx);
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
    console.log("owner:", info?.owner.toBase58());
    console.log("data:", info?.data.length, "B");
    console.log("hex:", Buffer.from(info?.data || Buffer.alloc(0)).toString("hex").slice(0, 160));
  } catch(e: any) {
    console.error("ERROR:", e?.message || String(e));
    if (e?.logs) console.error("LOGS:", e.logs.join("\n"));
    if (e?.stack) console.error(e.stack.split("\n").slice(0, 8).join("\n"));
  }
}
main().catch(console.error);
