import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import fs from "fs";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("../../authority.json", "utf-8")))
  );
  
  const wallet = new anchor.Wallet(adminKeypair);
  const devnetProvider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const idl = JSON.parse(fs.readFileSync("./src/lib/idl.json", "utf-8"));
  const programId = new PublicKey("HnysT79HmiJWWtE8W2LWbhBeXk27RxoohbJ4cQyw8AKr");
  const program = new Program(idl, devnetProvider);

  console.log("Super Admin Pubkey:", adminKeypair.publicKey.toBase58());

  const [platformPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform")],
    programId
  );
  console.log("Platform PDA:", platformPda.toBase58());

  // We set the treasury to the admin wallet or the default treasury
  const platformTreasury = adminKeypair.publicKey;

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

    console.log("Platform initialized successfully! Tx signature:", tx);
  } catch (err) {
    console.error("Initialization failed:", err);
  }
}

main();
