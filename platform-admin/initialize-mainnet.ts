import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";

async function main() {
  const adminSecret = JSON.parse(fs.readFileSync("../../authority.json", "utf-8"));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(adminSecret));
  
  const mainnetProvider = new anchor.AnchorProvider(
    new Connection("https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f"),
    new anchor.Wallet(adminKeypair),
    { commitment: "confirmed" }
  );

  const idl = JSON.parse(fs.readFileSync("./src/lib/idl.json", "utf-8"));
  const programId = new PublicKey("AEQrvbZvGwGcat5FXDXXZD71NiQsWNfdxvDFvdigxL5t");
  const program = new Program(idl, mainnetProvider);

  console.log("Super Admin Pubkey:", adminKeypair.publicKey.toBase58());

  const [platformPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform")],
    programId
  );
  console.log("Platform PDA:", platformPda.toBase58());

  // Platform treasury receives fee percentages and closed account rent
  const platformTreasury = new PublicKey("FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq");

  try {
    const tx = await (program as any).methods
      .initializePlatform(platformTreasury)
      .accounts({
        platform: platformPda,
        superAdmin: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([adminKeypair])
      .rpc();

    console.log("Platform initialized successfully on Mainnet! Tx signature:", tx);
  } catch (err) {
    console.error("Initialization failed:", err);
  }
}

main();
