import { Connection, PublicKey } from "@solana/web3.js";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const owner = new PublicKey("4PFPXzjHsEaogrxtLzJ8dZoj1jcabuFc57tdgTeL7R7i");

  const tokenProg = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const token2022Prog = new PublicKey("TokenzQdBNbXtJU34e2qpQX29ZK4555eUBJ1ibh86uLC");

  console.log("Fetching for owner:", owner.toBase58());

  const tokens = await connection.getParsedTokenAccountsByOwner(owner, { programId: tokenProg });
  const tokens2022 = await connection.getParsedTokenAccountsByOwner(owner, { programId: token2022Prog });

  console.log("\n--- Standard Token Accounts ---");
  for (const ta of tokens.value) {
    const data = ta.account.data.parsed?.info;
    console.log(`Mint: ${data.mint}, Amount: ${data.tokenAmount.uiAmount}, Decimals: ${data.tokenAmount.decimals}`);
  }

  console.log("\n--- Token-2022 Token Accounts ---");
  for (const ta of tokens2022.value) {
    const data = ta.account.data.parsed?.info;
    console.log(`Mint: ${data.mint}, Amount: ${data.tokenAmount.uiAmount}, Decimals: ${data.tokenAmount.decimals}`);
  }
}

main();
