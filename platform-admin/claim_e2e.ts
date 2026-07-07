import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, Keypair } from "@solana/web3.js";
import { createMint, mintTo } from "@solana/spl-token";
import {
  PROGRAM_ID,
  RPC_URL,
  buildIx,
  platformPDA,
  projectPDA,
  boxPDA,
  vaultPDA,
  retryWithBackoff,
  decodeAccount,
} from "./src/lib/program-ix";

const SLUG        = "clm-" + Math.floor(Math.random() * 1000000);
const BOX_ID      = 0n;
const DEVNET      = process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";
const SYS_PROG    = new PublicKey("11111111111111111111111111111111");
const TOKEN_PROG  = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG    = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");
const INST_SYSVAR = new PublicKey("Sysvar1nstructions1111111111111111111111111");

const conn = new Connection(DEVNET, "confirmed");

// Load deployer keypair (super admin key)
const kp = (() => {
  const kpRaw = require("fs").readFileSync(
    "/home/faizan/GeckuraBox/authority.json"
  );
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(kpRaw.toString()))
  );
})();

function logOk(s: string)   { console.log(`\x1b[32m ✓ ${s}\x1b[0m`); }
function logWarn(s: string) { console.log(`\x1b[33m ⚡ ${s}\x1b[0m`); }
function logErr(s: string)  { console.error(`\x1b[31m ✗ ${s}\x1b[0m`); }
function step(n: number, msg: string) {
  console.log(`\n\x1b[36m── Step ${n}: ${msg} ──\x1b[0m`);
}

async function sendWithWallet(
  ix: TransactionInstruction,
  walletPk: PublicKey,
  blockhash: string,
  nonceVal?: number
): Promise<string> {
  const tx = new Transaction().add(ix);
  if (nonceVal !== undefined) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: walletPk,
        toPubkey: walletPk,
        lamports: nonceVal + 1,
      })
    );
  }
  tx.feePayer        = walletPk;
  tx.recentBlockhash = blockhash;
  tx.sign(kp);
  const raw = tx.serialize();
  const sig = await retryWithBackoff(
    () => conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed" }),
    "sendRawTransaction",
  );
  await retryWithBackoff(() => conn.confirmTransaction(sig, "confirmed"), "confirmTransaction");
  return sig;
}

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
    ATA_PROG,
  )[0];
}

async function ppaExists(pk: PublicKey) {
  const acc = await retryWithBackoff(() => conn.getAccountInfo(pk), `ppa`);
  return !!acc;
}

async function getOrCreateAta(owner: PublicKey, mint: PublicKey, payer: Keypair, blockhash: string): Promise<PublicKey> {
  const ataAddr = ata(owner, mint);
  const existing = await retryWithBackoff(() => conn.getAccountInfo(ataAddr), `getOrCreateAta`);
  if (!existing) {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true,  isWritable: true  },
        { pubkey: ataAddr,          isSigner: false, isWritable: true  },
        { pubkey: owner,            isSigner: false, isWritable: false },
        { pubkey: mint,             isSigner: false, isWritable: false },
        { pubkey: SYS_PROG,         isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROG,       isSigner: false, isWritable: false },
      ],
      programId: ATA_PROG,
      data:      Buffer.alloc(0),
    });
    try {
      await sendWithWallet(ix, payer.publicKey, blockhash);
      logOk(`ATA ${ataAddr.toBase58().slice(0,8)} created.`);
    } catch {}
  }
  return ataAddr;
}

async function createTokenMint(decimals: number): Promise<PublicKey> {
  const mintKp = Keypair.generate();
  await createMint(
    conn,
    kp, // payer
    kp.publicKey, // mint authority
    kp.publicKey, // freeze authority
    decimals,
    mintKp
  );
  logOk(`Mint created: ${mintKp.publicKey.toBase58().slice(0,8)} (Decimals: ${decimals})`);
  return mintKp.publicKey;
}

async function mintTokensTo(mint: PublicKey, destination: PublicKey, amount: bigint) {
  await mintTo(
    conn,
    kp, // payer
    mint,
    destination,
    kp, // authority
    amount
  );
  logOk(`Minted ${amount} tokens to ${destination.toBase58().slice(0,8)}`);
}

async function main() {
  console.log(`\n\x1b[1m Claim Queue E2E Test (SPL Token + NFT)\n Slug:    ${SLUG}\n Program: ${PROGRAM_ID.toBase58()}\n RPC:     ${DEVNET}\x1b[0m\n`);

  try {
    const { publicKey } = kp;
    const [platform]   = await platformPDA();
    const [project]    = await projectPDA(SLUG);
    const [boxCfg]     = await boxPDA(project, BOX_ID);
    const [vault]      = await vaultPDA(project);
    
    // Create custom SPL token mint and NFT mint
    step(1, "Create custom SplToken & NFT mints");
    const tokenMint = await createTokenMint(9);
    const nftMint   = await createTokenMint(0);

    const prizeIdxToken = 0;
    const prizeIdxNft   = 1;

    const prizeItemToken = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxCfg.toBuffer(), Buffer.from([prizeIdxToken])],
      PROGRAM_ID,
    )[0];

    const prizeItemNft = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxCfg.toBuffer(), Buffer.from([prizeIdxNft])],
      PROGRAM_ID,
    )[0];

    const [receipt] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), publicKey.toBuffer(), boxCfg.toBuffer()],
      PROGRAM_ID
    );

    const bh = (await retryWithBackoff(() => conn.getLatestBlockhash(), "bh")).blockhash;

    // ── Initialize Platform ──
    if (!(await ppaExists(platform))) {
      const ix = buildIx("initialize_platform", {
        platform:        { pubkey: platform,   isSigner: false, isWritable: true  },
        super_admin:     { pubkey: publicKey,  isSigner: true,  isWritable: false },
        system_program:  { pubkey: SYS_PROG,   isSigner: false, isWritable: false },
      }, [tokenMint]); // platform native mint, can be anything
      await sendWithWallet(ix, publicKey, bh);
      logOk("Platform initialized.");
    }

    // ── Create Project ──
    const ixProj = buildIx("create_project", {
      platform:        { pubkey: platform,   isSigner: false, isWritable: true  },
      project:         { pubkey: project,    isSigner: false, isWritable: true  },
      super_admin:     { pubkey: publicKey,  isSigner: true,  isWritable: false },
      system_program:  { pubkey: SYS_PROG,   isSigner: false, isWritable: false },
    }, [SLUG, publicKey, publicKey, publicKey, 0n, 0]);
    await sendWithWallet(ixProj, publicKey, bh);
    logOk("Project created.");

    // ── Create Box Config ──
    step(2, "Create Box Config supporting both mints");
    const now = Math.floor(Date.now() / 1000);
    const start = now;
    const end = now + 86400;
    const ixBox = buildIx("create_box", {
      platform:        { pubkey: platform,  isSigner: false, isWritable: false },
      project:         { pubkey: project,   isSigner: false, isWritable: true  },
      box_config:      { pubkey: boxCfg,    isSigner: false, isWritable: true  },
      tenant:          { pubkey: publicKey, isSigner: true,  isWritable: false },
      system_program:  { pubkey: SYS_PROG,  isSigner: false, isWritable: false },
    }, [SLUG, BOX_ID, 0n, [tokenMint, nftMint, PublicKey.default], [0n, 0n, 0n], 100, start, end]);
    await sendWithWallet(ixBox, publicKey, bh);
    logOk("Box Config created.");

    // ── Create Prize Items ──
    step(3, "Create Prize Items (Odds 50% Token, Odds 50% NFT)");
    
    // Prize 0: SplToken (Odds 50%)
    const PRIZE_AMOUNT_TOKEN = 1_000_000_000n; // 1.0 Token
    const PRIZE_COUNT_TOKEN  = 5n;
    const DEPOSIT_TOKEN      = PRIZE_AMOUNT_TOKEN * PRIZE_COUNT_TOKEN;
    const ixPrizeToken = buildIx("create_prize_item", {
      platform:        { pubkey: platform,    isSigner: false, isWritable: false },
      project:         { pubkey: project,     isSigner: false, isWritable: false },
      box_config:      { pubkey: boxCfg,      isSigner: false, isWritable: true  },
      prize_item:      { pubkey: prizeItemToken, isSigner: false, isWritable: true  },
      vault:           { pubkey: vault,       isSigner: false, isWritable: false },
      tenant:          { pubkey: publicKey,  isSigner: true,  isWritable: false },
      system_program:  { pubkey: SYS_PROG,    isSigner: false, isWritable: false },
    }, [SLUG, BOX_ID, prizeIdxToken, 1, tokenMint, PRIZE_AMOUNT_TOKEN, 50, PRIZE_COUNT_TOKEN]);
    await sendWithWallet(ixPrizeToken, publicKey, bh);
    logOk("SplToken Prize Item created (Odds 50%).");

    // Prize 1: NFT (Odds 50%)
    const PRIZE_AMOUNT_NFT = 1n; // 1 NFT
    const PRIZE_COUNT_NFT  = 5n;
    const DEPOSIT_NFT      = PRIZE_AMOUNT_NFT * PRIZE_COUNT_NFT;
    const ixPrizeNft = buildIx("create_prize_item", {
      platform:        { pubkey: platform,  isSigner: false, isWritable: false },
      project:         { pubkey: project,   isSigner: false, isWritable: false },
      box_config:      { pubkey: boxCfg,    isSigner: false, isWritable: true  },
      prize_item:      { pubkey: prizeItemNft, isSigner: false, isWritable: true  },
      vault:           { pubkey: vault,     isSigner: false, isWritable: false },
      tenant:          { pubkey: publicKey, isSigner: true,  isWritable: false },
      system_program:  { pubkey: SYS_PROG,  isSigner: false, isWritable: false },
    }, [SLUG, BOX_ID, prizeIdxNft, 2, nftMint, PRIZE_AMOUNT_NFT, 50, PRIZE_COUNT_NFT]);
    await sendWithWallet(ixPrizeNft, publicKey, bh);
    logOk("NFT Prize Item created (Odds 50%).");

    // ── Initialize Vault & Setup ATAs ──
    step(4, "Initialize Vault & fund prizes");
    const ixVault = buildIx("initialize_vault", {
      platform:        { pubkey: platform,  isSigner: false, isWritable: false },
      project:         { pubkey: project,   isSigner: false, isWritable: true  },
      vault:           { pubkey: vault,     isSigner: false, isWritable: true  },
      tenant:          { pubkey: publicKey, isSigner: true,  isWritable: false },
      system_program:  { pubkey: SYS_PROG,  isSigner: false, isWritable: false },
    }, [SLUG]);
    await sendWithWallet(ixVault, publicKey, bh);
    logOk("Vault account initialized.");

    // Setup ATAs
    const tokenUserAta  = await getOrCreateAta(publicKey, tokenMint, kp, bh);
    const tokenVaultAta = await getOrCreateAta(vault,     tokenMint, kp, bh);
    const nftUserAta    = await getOrCreateAta(publicKey, nftMint,   kp, bh);
    const nftVaultAta   = await getOrCreateAta(vault,     nftMint,   kp, bh);

    // Mint tokens to User ATAs
    await mintTokensTo(tokenMint, tokenUserAta, DEPOSIT_TOKEN);
    await mintTokensTo(nftMint,   nftUserAta,   DEPOSIT_NFT);

    // Fund Vault with Token
    const ixDepToken = buildIx("manage_prize", {
      project:                { pubkey: project,             isSigner: false, isWritable: false },
      box_config:              { pubkey: boxCfg,             isSigner: false, isWritable: true  },
      prize_item:              { pubkey: prizeItemToken,     isSigner: false, isWritable: true  },
      vault:                   { pubkey: vault,              isSigner: false, isWritable: false },
      token_mint:              { pubkey: tokenMint,          isSigner: false, isWritable: false },
      tenant_token_account:    { pubkey: tokenUserAta,       isSigner: false, isWritable: true  },
      vault_token_account:     { pubkey: tokenVaultAta,      isSigner: false, isWritable: true  },
      tenant:                  { pubkey: publicKey,          isSigner: true,  isWritable: true  },
      token_program:           { pubkey: TOKEN_PROG,         isSigner: false, isWritable: false },
      associated_token_program:{ pubkey: ATA_PROG,           isSigner: false, isWritable: false },
      system_program:          { pubkey: SYS_PROG,           isSigner: false, isWritable: false },
    }, [SLUG, prizeIdxToken, BOX_ID, 0, DEPOSIT_TOKEN]);
    await sendWithWallet(ixDepToken, publicKey, bh);

    // Fund Vault with NFT
    const ixDepNft = buildIx("manage_prize", {
      project:                { pubkey: project,             isSigner: false, isWritable: false },
      box_config:              { pubkey: boxCfg,             isSigner: false, isWritable: true  },
      prize_item:              { pubkey: prizeItemNft,       isSigner: false, isWritable: true  },
      vault:                   { pubkey: vault,              isSigner: false, isWritable: false },
      token_mint:              { pubkey: nftMint,            isSigner: false, isWritable: false },
      tenant_token_account:    { pubkey: nftUserAta,         isSigner: false, isWritable: true  },
      vault_token_account:     { pubkey: nftVaultAta,        isSigner: false, isWritable: true  },
      tenant:                  { pubkey: publicKey,          isSigner: true,  isWritable: true  },
      token_program:           { pubkey: TOKEN_PROG,         isSigner: false, isWritable: false },
      associated_token_program:{ pubkey: ATA_PROG,           isSigner: false, isWritable: false },
      system_program:          { pubkey: SYS_PROG,           isSigner: false, isWritable: false },
    }, [SLUG, prizeIdxNft, BOX_ID, 0, DEPOSIT_NFT]);
    await sendWithWallet(ixDepNft, publicKey, bh);
    logOk("Vault fully funded with SplTokens & NFTs.");

    // ── Open Box Multiple Times ──
    step(5, "Open box multiple times to win both prizes");
    const openCount = 5;
    for (let i = 0; i < openCount; i++) {
      const openIx = buildIx("open_box", {
        platform:       { pubkey: platform,      isSigner: false, isWritable: false },
        project:        { pubkey: project,       isSigner: false, isWritable: false },
        box_config:     { pubkey: boxCfg,        isSigner: false, isWritable: true  },
        receipt:        { pubkey: receipt,       isSigner: false, isWritable: true  },
        vault:          { pubkey: vault,         isSigner: false, isWritable: true  },
        user:           { pubkey: publicKey,     isSigner: true,  isWritable: true  },
        fee_wallet:     { pubkey: publicKey,     isSigner: false, isWritable: true  },
        fee_wallet_2:   { pubkey: publicKey,     isSigner: false, isWritable: true  },
        tenant_wallet:  { pubkey: publicKey,     isSigner: false, isWritable: true  },
        system_program: { pubkey: SYS_PROG,      isSigner: false, isWritable: false },
        slot_hashes:    { pubkey: SLOT_HASHES,   isSigner: false, isWritable: false },
        instructions:   { pubkey: INST_SYSVAR,   isSigner: false, isWritable: false },
      }, [SLUG, BOX_ID, 1], [
        { pubkey: prizeItemToken, isSigner: false, isWritable: true },
        { pubkey: prizeItemNft,   isSigner: false, isWritable: true }
      ]);
      const sig = await sendWithWallet(openIx, publicKey, bh, i);
      logOk(`Box opened [${i+1}/${openCount}] — tx: ${sig.slice(0, 8)}...`);
    }

    // Verify receipt has claimable prizes now
    const receiptAccAfter = await conn.getAccountInfo(receipt);
    if (!receiptAccAfter) {
      logErr("Receipt not found after open_box!");
      process.exit(1);
    }
    const decodedAfter = decodeAccount("BoxReceipt", receiptAccAfter.data);
    const claimablesAfter = decodedAfter.claimablePrizes || decodedAfter.claimable_prizes || [];
    logOk(`BoxReceipt claimable prizes count: ${claimablesAfter.length}`);

    // Map out the types won
    const tokenWonCount = claimablesAfter.filter((c: any) => c.prizeType === 1).length;
    const nftWonCount   = claimablesAfter.filter((c: any) => c.prizeType === 2).length;
    logOk(`Rewards in claim queue: ${tokenWonCount} SplTokens, ${nftWonCount} NFTs.`);

    // Check balances before claim
    let tokenBalBefore = 0n;
    try {
      const bRes = await conn.getTokenAccountBalance(tokenUserAta);
      tokenBalBefore = BigInt(bRes.value.amount);
    } catch {}
    let nftBalBefore = 0n;
    try {
      const bRes = await conn.getTokenAccountBalance(nftUserAta);
      nftBalBefore = BigInt(bRes.value.amount);
    } catch {}
    logOk(`User balances before claiming: SplToken: ${tokenBalBefore}, NFT: ${nftBalBefore}`);

    // ── Claim Prizes ──
    step(6, "Claim all accumulated prizes in one batch");
    
    // Remaining accounts list must contain the vault & user ATA for both mints
    const claimRemainingAccounts = [
      { pubkey: tokenVaultAta, isSigner: false, isWritable: true },
      { pubkey: tokenUserAta,  isSigner: false, isWritable: true },
      { pubkey: nftVaultAta,   isSigner: false, isWritable: true },
      { pubkey: nftUserAta,    isSigner: false, isWritable: true },
    ];

    const claimIx = buildIx("claim_prizes", {
      platform:       { pubkey: platform,      isSigner: false, isWritable: false },
      project:        { pubkey: project,       isSigner: false, isWritable: false },
      box_config:     { pubkey: boxCfg,        isSigner: false, isWritable: false },
      receipt:        { pubkey: receipt,       isSigner: false, isWritable: true  },
      vault:          { pubkey: vault,         isSigner: false, isWritable: true  },
      user:           { pubkey: publicKey,     isSigner: true,  isWritable: true  },
      system_program: { pubkey: SYS_PROG,      isSigner: false, isWritable: false },
      token_program:  { pubkey: TOKEN_PROG,     isSigner: false, isWritable: false },
    }, [SLUG], claimRemainingAccounts);

    const claimSig = await sendWithWallet(claimIx, publicKey, bh);
    logOk(`Claim transaction succeeded — tx: ${claimSig}`);

    // Verify receipt queue is now cleared
    const receiptAccFinal = await conn.getAccountInfo(receipt);
    if (!receiptAccFinal) {
      logErr("Receipt missing after claim!");
      process.exit(1);
    }
    const decodedFinal = decodeAccount("BoxReceipt", receiptAccFinal.data);
    const claimablesFinal = decodedFinal.claimablePrizes || decodedFinal.claimable_prizes || [];
    logOk(`BoxReceipt claimable prizes count after claim: ${claimablesFinal.length}`);

    // Check balances after claiming
    let tokenBalAfter = 0n;
    try {
      const bRes = await conn.getTokenAccountBalance(tokenUserAta);
      tokenBalAfter = BigInt(bRes.value.amount);
    } catch {}
    let nftBalAfter = 0n;
    try {
      const bRes = await conn.getTokenAccountBalance(nftUserAta);
      nftBalAfter = BigInt(bRes.value.amount);
    } catch {}
    logOk(`User balances after claiming: SplToken: ${tokenBalAfter}, NFT: ${nftBalAfter}`);

    const expectedTokenIncrease = BigInt(tokenWonCount) * PRIZE_AMOUNT_TOKEN;
    const expectedNftIncrease   = BigInt(nftWonCount) * PRIZE_AMOUNT_NFT;

    if (tokenBalAfter === tokenBalBefore + expectedTokenIncrease && nftBalAfter === nftBalBefore + expectedNftIncrease && claimablesFinal.length === 0) {
      logOk("All SplToken and NFT prizes claimed successfully from queue! Manual claim works flawlessly! 🏆✅");
    } else {
      logErr("Validation failed. Balances did not increase by correct won amounts or claim queue was not cleared.");
      process.exit(1);
    }

  } catch (e: any) {
    logErr(e?.message || e?.toString() || String(e));
    if (e?.logs)   console.error("Program logs:",  e.logs);
    process.exit(1);
  }
}

main();
