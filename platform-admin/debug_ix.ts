import { PublicKey } from "@solana/web3.js";
import { buildIx, PROGRAM_ID } from "./src/lib/program-ix";

const publicKey = new PublicKey("FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq");
const SLUG      = "fox-test";
const BOX_ID    = 0n;
const PRIZE_IDX = 0n;
const DEPOSIT   = 1_000_000n;
const mint      = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_PROG  = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG    = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYS_PROG    = new PublicKey("11111111111111111111111111111111");

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()], ATA_PROG)[0];
}

const [platform] = PublicKey.findProgramAddressSync([Buffer.from("platform")], PROGRAM_ID);
const [project]  = PublicKey.findProgramAddressSync([Buffer.from("project"), Buffer.from(SLUG)], PROGRAM_ID);
const [boxCfg]   = PublicKey.findProgramAddressSync([
  Buffer.from("box"), project.toBuffer(),
  Buffer.from(new Uint8Array(new BigUint64Array([BOX_ID]).buffer))
], PROGRAM_ID);
const [vault]    = PublicKey.findProgramAddressSync([Buffer.from("vault"), project.toBuffer()], PROGRAM_ID);
const prizeItem  = PublicKey.findProgramAddressSync([Buffer.from("prize"), boxCfg.toBuffer(), Buffer.from([0])], PROGRAM_ID)[0];
const tenantAta  = ata(publicKey, mint);
const vaultAta   = ata(vault, mint);

console.log("platform:", platform.toBase58());
console.log("project:", project.toBase58());
console.log("boxCfg:", boxCfg.toBase58());
console.log("vault:", vault.toBase58());
console.log("prizeItem:", prizeItem.toBase58());
console.log("tenantAta:", tenantAta.toBase58());
console.log("vaultAta:", vaultAta.toBase58());

const ix = buildIx("deposit_prize", {
  platform:               { pubkey: platform,  isSigner: false, isWritable: false },
  project:                { pubkey: project,   isSigner: false, isWritable: false },
  boxConfig:              { pubkey: boxCfg,    isSigner: false, isWritable: false },
  prizeItem:              { pubkey: prizeItem, isSigner: false, isWritable: false },
  vault:                  { pubkey: vault,     isSigner: false, isWritable: false },
  tokenMint:              { pubkey: mint,      isSigner: false, isWritable: false },
  tenantTokenAccount:     { pubkey: tenantAta, isSigner: false, isWritable: true  },
  vaultTokenAccount:      { pubkey: vaultAta,  isSigner: false, isWritable: true  },
  tenant:                 { pubkey: publicKey, isSigner: true,  isWritable: false },
  token_program:          { pubkey: TOKEN_PROG,  isSigner: false, isWritable: false },
  associated_token_program: { pubkey: ATA_PROG, isSigner: false, isWritable: false },
  system_program:         { pubkey: SYS_PROG,  isSigner: false, isWritable: false },
}, [SLUG, PRIZE_IDX, BOX_ID, DEPOSIT]);

console.log("\ninstruction data hex:", ix.data.toString("hex"));
console.log("data length:", ix.data.length);
console.log("\nkeys:");
ix.keys.forEach((k: any, i: number) => {
  console.log(`  ${i}: ${k.pubkey.toBase58().slice(0,20)}...  signer=${k.isSigner}  writable=${k.isWritable}`);
});
