import { Connection, PublicKey } from "@solana/web3.js";

const USER_PUBKEY = new PublicKey("8RPYCAauqp3kXNvrRxiPpnv4oyFqS9YaAxdzQR94PkGb");
const RPC = "https://mainnet.helius-rpc.com/?api-key=884d745d-5bb6-416d-97b5-61faeaa4ed5f";

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(USER_PUBKEY, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });

  console.log(`User Wallet: ${USER_PUBKEY.toBase58()}`);
  console.log(`Token Accounts Count: ${tokenAccounts.value.length}`);

  for (const { pubkey, account } of tokenAccounts.value) {
    const data = account.data.parsed.info;
    console.log(`  ATA: ${pubkey.toBase58()}`);
    console.log(`  Mint: ${data.mint}`);
    console.log(`  Amount: ${data.tokenAmount.uiAmountString}`);
  }
}

main().catch(console.error);
