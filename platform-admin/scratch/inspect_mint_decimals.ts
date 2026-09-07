import { Connection, PublicKey } from "@solana/web3.js";

const RPC = "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f";

const VAULT_PDA = new PublicKey("CFTkPGccUM6rYmi5vH31gKq5W7ifFJHuy493uN9NNiQN");
const FREE_MINT = new PublicKey("8734tKb8YZsyKDbnws4vQTWeoNbXmP4vcoG1S2hGzY3m");
const GECKURA_TOKEN = new PublicKey("5xUbTjhVW3PDVSrHar2i5CKFEjjP5NFSNheTmmZNSHtQ");

const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

async function main() {
  const conn = new Connection(RPC, "confirmed");

  // Get Mint info for Free Mint
  const mintInfo = await conn.getParsedAccountInfo(FREE_MINT);
  console.log(`=== Geckura Free Mint (${FREE_MINT.toBase58()}) ===`);
  if (mintInfo.value) {
    const data: any = mintInfo.value.data;
    console.log(`Decimals: ${data.parsed.info.decimals}`);
    console.log(`Supply: ${data.parsed.info.supply}`);
  }

  // Derive Vault ATA for Free Mint
  const [vaultFreeMintAta] = PublicKey.findProgramAddressSync(
    [VAULT_PDA.toBuffer(), TOKEN_PROG.toBuffer(), FREE_MINT.toBuffer()],
    ATA_PROG
  );

  console.log(`Vault ATA for Free Mint: ${vaultFreeMintAta.toBase58()}`);
  const ataInfo = await conn.getParsedAccountInfo(vaultFreeMintAta);
  if (ataInfo.value) {
    const data: any = ataInfo.value.data;
    console.log(`Vault ATA Balance (UI): ${data.parsed.info.tokenAmount.uiAmountString}`);
    console.log(`Vault ATA Balance (raw): ${data.parsed.info.tokenAmount.amount}`);
  } else {
    console.log(`Vault ATA does NOT exist!`);
  }

  // Get Mint info for Geckura Token
  console.log(`\n=== Geckura Token (${GECKURA_TOKEN.toBase58()}) ===`);
  const mintInfo2 = await conn.getParsedAccountInfo(GECKURA_TOKEN);
  if (mintInfo2.value) {
    const data: any = mintInfo2.value.data;
    console.log(`Decimals: ${data.parsed.info.decimals}`);
    console.log(`Supply: ${data.parsed.info.supply}`);
  }

  const [vaultGeckuraAta] = PublicKey.findProgramAddressSync(
    [VAULT_PDA.toBuffer(), TOKEN_PROG.toBuffer(), GECKURA_TOKEN.toBuffer()],
    ATA_PROG
  );
  console.log(`Vault ATA for Geckura Token: ${vaultGeckuraAta.toBase58()}`);
  const ataInfo2 = await conn.getParsedAccountInfo(vaultGeckuraAta);
  if (ataInfo2.value) {
    const data: any = ataInfo2.value.data;
    console.log(`Vault ATA Balance (UI): ${data.parsed.info.tokenAmount.uiAmountString}`);
    console.log(`Vault ATA Balance (raw): ${data.parsed.info.tokenAmount.amount}`);
  } else {
    console.log(`Vault ATA does NOT exist!`);
  }
}

main().catch(console.error);
