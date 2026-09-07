import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { BorshAccountsCoder, BorshInstructionCoder } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";

const RPC = "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f";
const PROGRAM_ID = new PublicKey("AEQrvbZvGwGcat5FXDXXZD71NiQsWNfdxvDFvdigxL5t");
const USER_PUBKEY = new PublicKey("8RPYCAauqp3kXNvrRxiPpnv4oyFqS9YaAxdzQR94PkGb");
const SLUG = "geckura";

const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const idlPath = path.join(process.cwd(), "src/lib/idl.json");
  const IDL = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const accountsCoder = new BorshAccountsCoder(IDL as any);
  const ixCoder = new BorshInstructionCoder(IDL as any);

  const [projectPda] = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(SLUG)], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), projectPda.toBuffer()], PROGRAM_ID);
  const [receiptPda] = PublicKey.findProgramAddressSync([Buffer.from("receipt"), USER_PUBKEY.toBuffer(), projectPda.toBuffer()], PROGRAM_ID);
  const [platformPda] = PublicKey.findProgramAddressSync([Buffer.from("platform")], PROGRAM_ID);

  const receiptInfo = await conn.getAccountInfo(receiptPda);
  if (!receiptInfo) return;

  const decoded = accountsCoder.decode("BoxReceipt", receiptInfo.data);
  const rawPrizes = decoded.claimablePrizes || decoded.claimable_prizes || [];

  const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  const mintsToCreateATA: string[] = [];

  for (const prize of rawPrizes) {
    const mintStr = (prize.tokenMint ?? prize.token_mint)?.toBase58();
    if (mintStr) {
      const mint = new PublicKey(mintStr);
      const vaultAta = PublicKey.findProgramAddressSync([vaultPda.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()], ATA_PROG)[0];
      const userAta = PublicKey.findProgramAddressSync([USER_PUBKEY.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()], ATA_PROG)[0];

      if (!remainingAccounts.some(a => a.pubkey.equals(vaultAta))) {
        remainingAccounts.push({ pubkey: vaultAta, isSigner: false, isWritable: true });
      }
      if (!remainingAccounts.some(a => a.pubkey.equals(userAta))) {
        remainingAccounts.push({ pubkey: userAta, isSigner: false, isWritable: true });
      }
      if (!mintsToCreateATA.includes(mintStr)) {
        mintsToCreateATA.push(mintStr);
      }
    }
  }

  const tx = new Transaction();

  for (const mintStr of mintsToCreateATA) {
    const mint = new PublicKey(mintStr);
    const userAta = PublicKey.findProgramAddressSync([USER_PUBKEY.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()], ATA_PROG)[0];
    const info = await conn.getAccountInfo(userAta);
    if (!info) {
      console.log(`Adding ATA creation instruction for ${mintStr}...`);
      tx.add(createAssociatedTokenAccountInstruction(USER_PUBKEY, userAta, USER_PUBKEY, mint));
    }
  }

  const ixData = ixCoder.encode("claim_prizes", { slug: SLUG });
  const keys = [
    { pubkey: platformPda, isSigner: false, isWritable: false },
    { pubkey: projectPda, isSigner: false, isWritable: false },
    { pubkey: receiptPda, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: USER_PUBKEY, isSigner: true, isWritable: true },
    { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROG, isSigner: false, isWritable: false },
    ...remainingAccounts
  ];

  tx.add(new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: ixData
  }));

  tx.feePayer = USER_PUBKEY;
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  console.log("\n--- Simulating Exact Anchor Claim Instruction ---");
  const sim = await conn.simulateTransaction(tx);
  console.log("Simulation error:", JSON.stringify(sim.value.err, null, 2));
  console.log("\nSimulation logs:");
  sim.value.logs?.forEach(l => console.log("  ", l));
}

main().catch(console.error);
