// Minimal debug: print the serialized instruction and try sending it
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl } from "@solana/web3.js";
import { BinaryWriter, readU16, readU32, readU64 } from "borsh";
import { PROGRAM_ID, RPC_URL } from "./src/lib/program-ix";

const IDL = require("./src/lib/idl.json");

const pgId = PROGRAM_ID;

const TREASURY = new PublicKey("So11111111111111111111111111111111111111112");

const conn = new Connection(RPC_URL, "confirmed");

const [platform] = PublicKey.findProgramAddressSync([Buffer.from("platform")], pgId);
const [project]  = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from("fox-test")], pgId);
const TREASURY_KEYPAIR = require("./.treasury_keypair.json");

async function main() {
  const ixDef = IDL.instructions.find((ix: any) => ix.name === "create_project");
  console.log("ixDef accounts:", JSON.stringify(ixDef.accounts));
  console.log("ixDef args:", JSON.stringify(ixDef.args));

  // Manual borsh
  const definedTypes = new Map<string, any[][]>();
  for (const t of (IDL.types ?? [])) definedTypes.set(t.name, [t]);

  const w = new BinaryWriter();
  for (const b of ixDef.discriminator) w.writeU8(b);
  // args
  const args = [
    "fox-test",                           // slug (string)
    TREASURY_KEYPAIR.publicKey,           // authority (pubkey)
    TREASURY_KEYPAIR.publicKey,           // fee_wallet (pubkey)
    0n,                                   // fee_lamports (u64)
    "Fox Test Project",                   // name (string)
    "E2E Fox test",                       // description (string)
    "",                                   // logo_uri (string)
    "",                                   // bg_uri (string)
    "#39ff14",                            // theme_color (string)
  ];
  for (let i = 0; i < args.length; i++) {
    // inline encode for each arg type
    const argType = ixDef.args[i].type;
    const v = args[i];
    // simplified
    if (argType === "string") w.writeString(v);
    else if (argType === "pubkey") w.writeBuffer(new PublicKey(v).toBuffer());
    else if (argType === "u64") w.writeU64(BigInt(v));
    else throw new Error(`unsupported arg type: ${JSON.stringify(argType)}`);
  }

  const dataBuf = Buffer.from(w.toArray());
  console.log("Instruction data hex:", dataBuf.toString("hex"));
  console.log("Instruction data bytes:", dataBuf.length);

  const keys = [
    { pubkey: platform, isSigner: false, isWritable: true  },
    { pubkey: project,  isSigner: false, isWritable: true  },
    { pubkey: TREASURY_KEYPAIR.publicKey, isSigner: true, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: pgId,
    data: dataBuf,
    keys,
  });

  const bh = await conn.getLatestBlockhash();
  const tx = new Transaction().add(ix);
  tx.feePayer = TREASURY_KEYPAIR.publicKey;
  tx.recentBlockhash = bh.blockhash;

  const signed = tx.sign(TREASURY_KEYPAIR);
  const raw = signed.serialize();
  console.log("TX serialized:", raw.length, "bytes");

  try {
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
    console.log("sig:", sig);
    await conn.confirmTransaction(sig);
    console.log("CONFIRMED");
  } catch (e: any) {
    console.error("TX failed:", e.message);
    console.error("logs:", e.logs);
    console.error("EL JSON:", JSON.stringify(e).substring(0, 500));
  }
}

main().catch(console.error);
