import { Connection, PublicKey, PublicKeyInitData } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("3UsFkjHEJF37odV39hMcPcR6w7ifAC5KVRh6MzMpRQ3Z");
const SYS_PROG = new PublicKey("11111111111111111111111111111111");
const TOKEN_PROG = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG   = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const WALLET    = new PublicKey("FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq");
const MINT      = new PublicKey("So11111111111111111111111111111111111111112");
const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com", "confirmed");

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
    ATA_PROG,
  )[0];
}

const PLATFORM  = new PublicKey("31fvNuiRCwnYJSa7LR6Ef6y778djTQmAhWr9PbuG3Ktd");
const PROJECT   = new PublicKey("8MeCBEf6d5MGQ77GiArNUep1vG3Ni9TW3PogUjs29A98");
const BOXCFG    = new PublicKey("2rQc33t8sFCYjPW12wJn86xikjF8DxHL5qL6gfHExnho");
const PRIZEITEM = new PublicKey("6MnRFaauZeWbmJVpi7sZE5qJVp5Vys2Xpzvzm6UrUQQd");
const VAULT     = new PublicKey("4q5KhT5hJFbyNaW7AKfLksBfwTYt3qvHm7rL1od6aJrQ");
const TENANT_ATA = ata(WALLET, MINT);
const VAULT_ATA  = ata(VAULT, MINT);

const DEPOSIT_ACCTS = [
  PLATFORM, PROJECT, BOXCFG, PRIZEITEM, VAULT, MINT,
  TENANT_ATA, VAULT_ATA, WALLET, TOKEN_PROG, ATA_PROG, SYS_PROG,
];

async function main() {
  console.log("=== deposit_prize account ownership check ===\n");
  for (let i = 0; i < DEPOSIT_ACCTS.length; i++) {
    const pk = DEPOSIT_ACCTS[i];
    const acc = await conn.getAccountInfo(pk, "confirmed");
    if (!acc) { console.log(`[${i}] ${pk.toBase58().slice(0,8)} MISSING`); continue; }
    const ownedByMbox = acc.owner.equals(PROGRAM_ID);
    const label = ownedByMbox ? "\x1b[32mOK (mystery_box)\x1b[0m" : acc.owner.equals(SYS_PROG) ? "\x1b[33mNativeLoader\x1b[0m" : `\x1b[31mOTHER: ${acc.owner.toBase58().slice(0,8)}\x1b[0m`;
    console.log(`[${i}] ${pk.toBase58().slice(0,8)}  owner=${label}  lamports=${acc.lamports}  data=${acc.data.length}B`);
  }
}
main().catch(console.error);
