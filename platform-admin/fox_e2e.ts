import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl } from "@solana/web3.js";

import {
  PROGRAM_ID,
  RPC_URL,
  buildIx,
  platformPDA,
  projectPDA,
  boxPDA,
  vaultPDA,
  retryWithBackoff,
} from "./src/lib/program-ix";
import {
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccount,
} from "@solana/spl-token";

// ── constants ────────────────────────────────────────────────────────────────

const SLUG        = "fox-test";
const BOX_ID      = 0n;
const DEVNET      = process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl("devnet");
const SYS_PROG    = new PublicKey("11111111111111111111111111111111");
const TOKEN_PROG  = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROG    = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Prize config  PrizeType::Sol = 0
const PRIZE_TYPE     = 0;
const PRIZE_AMOUNT   = 1_000_000n;     // lamports per prize copy
const PRIZE_COUNT    = 5n;
const DEPOSIT_TOTAL  = PRIZE_AMOUNT * PRIZE_COUNT; // 5_000_000_000

const conn = new Connection(DEVNET, "confirmed");

// Load deployer keypair once
const kp = (() => {
  const kpRaw = require("fs").readFileSync(
    process.env.WALLET_KEYPAIR || require("os").homedir() + "/.config/solana/id.json"
  );
  return require("@solana/web3.js").Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(kpRaw.toString()))
  );
})();

// ── logging helpers ─────────────────────────────────────────────────────────

function logOk(s: string)   { console.log(`\x1b[32m ✓ ${s}\x1b[0m`); }
function logWarn(s: string) { console.log(`\x1b[33m ⚡ ${s}\x1b[0m`); }
function logErr(s: string)  { console.error(`\x1b[31m ✗ ${s}\x1b[0m`); }
function step(n: number, msg: string) {
  console.log(`\n\x1b[36m── Step ${n}: ${msg} ──\x1b[0m`);
}

// ── ATA helper  (deterministic PDA via findProgramAddressSync) ─────────────────

function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
    ATA_PROG,
  )[0];
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function walletBalance(pk: PublicKey) { return conn.getBalance(pk); }

async function ppaExists(pk: PublicKey) {
  const acc = await retryWithBackoff(() => conn.getAccountInfo(pk), `ppa(${pk.toBase58().slice(0,8)})`);
  return !!acc;
}

/** True iff the account at `pk` is owned by the mystery-box program */
async function ownedByProgram(pk: PublicKey): Promise<boolean> {
  const acc = await retryWithBackoff(() => conn.getAccountInfo(pk), `opa(${pk.toBase58().slice(0,8)})`);
  return !!acc && acc.owner.equals(PROGRAM_ID);
}

/** Build + sign + send a single instruction. */
async function sendWithWallet(
  ix: TransactionInstruction,
  walletPk: PublicKey,
  blockhash: string,
): Promise<string> {
  const tx = new Transaction().add(ix);
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

/**
 * Ensure the ATA for the native mint (So111...) exists on-chain.
 * Uses the raw SPL-ATA `create` instruction directly — the factory
 * `createAssociatedTokenAccount` from @solana/spl-token throws under
 * Node 24 with native mints, so we skip it entirely.
 */
async function createNativeAta(owner: PublicKey, mint: PublicKey, payer: typeof kp, blockhash: string): Promise<PublicKey> {
  // Derive ATA deterministically with findProgramAddressSync (matches ata() helper)
  const ataAddr = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROG.toBuffer(), mint.toBuffer()],
    ATA_PROG,
  )[0];
  const existing = await retryWithBackoff(() => conn.getAccountInfo(ataAddr), `nativeAta_get(${ataAddr.toBase58().slice(0,8)})`);
  if (!existing) {
    // Raw SPL ATA create instruction — 6 keys: payer(0) | atan(1) | owner(2) | mint(3) | system_program(4) | token_program(5)
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
      const sig = await sendWithWallet(ix, payer.publicKey, blockhash);
      logOk(`Native ATA ${ataAddr.toBase58().slice(0,8)} — created: ${sig}`);
    } catch(e: any) {
      logWarn(`Native ATA create failed (may already exist): ${e.message || e}`);
    }
  }

  // Check token account balance and wrap SOL if needed
  let currentBalance = 0n;
  try {
    const balRes = await conn.getTokenAccountBalance(ataAddr);
    currentBalance = BigInt(balRes.value.amount);
  } catch {
    currentBalance = 0n;
  }

  if (currentBalance < DEPOSIT_TOTAL) {
    const wrapAmount = DEPOSIT_TOTAL - currentBalance;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: ataAddr,
        lamports: Number(wrapAmount),
      }),
      new TransactionInstruction({
        keys: [{ pubkey: ataAddr, isSigner: false, isWritable: true }],
        programId: TOKEN_PROG,
        data: Buffer.from([17]), // SyncNative
      })
    );
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(payer);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    logOk(`Wrapped ${Number(wrapAmount)/1e9} SOL into ATA — tx: ${sig}`);
  }

  return ataAddr;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n\x1b[1m Fox E2E: Deposit + Withdraw Test\n Program: ${PROGRAM_ID.toBase58()}\n RPC:     ${RPC_URL}\x1b[0m`
  );

  try {
    step(0, "Pre-flight checks");
    const { publicKey } = kp;
    const bal = await walletBalance(publicKey);
    logOk(`Wallet: ${publicKey.toBase58()}  (${(bal / 1e9).toFixed(4)} SOL)`);
    if (bal < 2_000_000_000) { logErr("Balance < 2 SOL — fund wallet first"); process.exit(1); }

    const [platform]   = await platformPDA();
    const [project]    = await projectPDA(SLUG);
    const [boxCfg]     = await boxPDA(project, BOX_ID);
    const [vault]      = await vaultPDA(project);
    const prizeIdx     = 0;
    const prizeItem    = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxCfg.toBuffer(), Buffer.from([prizeIdx])],
      PROGRAM_ID,
    )[0];

    logOk(` platform:     ${platform.toBase58()}`);
    logOk(` project:      ${project.toBase58()}`);
    logOk(` box_config:   ${boxCfg.toBase58()}`);
    logOk(` vault:        ${vault.toBase58()}`);
    logOk(` prize_item:   ${prizeItem.toBase58()}`);

    // Derive AT addresses (deterministic PDA derivation via getAssociatedTokenAddressSync)
    const mint      = new PublicKey("So11111111111111111111111111111111111111112");
    const tenantAta = ata(publicKey, mint);
    const vaultAta  = ata(vault,    mint);

    logOk(` tenant_ata:   ${tenantAta.toBase58()}`);
    logOk(` vault_ata:    ${vaultAta.toBase58()}`);

    const bh = (await retryWithBackoff(() => conn.getLatestBlockhash(), "bh(step0)")).blockhash;

    // ── Step 1 ──────────────────────────────────────────────────────────────────
    step(1, "initialize_platform");
    if (!(await ppaExists(platform))) {
      const ix = buildIx("initialize_platform", {
        platform:        { pubkey: platform,   isSigner: false, isWritable: true  },
        super_admin:     { pubkey: publicKey,  isSigner: true,  isWritable: false },
        system_program:  { pubkey: SYS_PROG,   isSigner: false, isWritable: false },
      }, [mint]);
      const sig = await sendWithWallet(ix, publicKey, bh);
      logOk(`Platform initialized — tx: ${sig}`);
    } else {
      logWarn("Platform already initialized — skipping");
    }

    // ── Step 2 ──────────────────────────────────────────────────────────────────
    step(2, "create_project");
    if (!(await ppaExists(project))) {
      const ix = buildIx("create_project", {
        platform:        { pubkey: platform,   isSigner: false, isWritable: true  },
        project:         { pubkey: project,    isSigner: false, isWritable: true  },
        super_admin:     { pubkey: publicKey,  isSigner: true,  isWritable: false },
        system_program:  { pubkey: SYS_PROG,   isSigner: false, isWritable: false },
      }, [
        SLUG, publicKey, publicKey, 0n, 0,
      ]);
      const sig = await sendWithWallet(ix, publicKey, bh);
      logOk(`Project created — tx: ${sig}`);
    } else {
      logWarn("Project already created — skipping");
    }

    // ── Step 3 ──────────────────────────────────────────────────────────────────
    step(3, "create_box  (id=0)");
    if (!(await ppaExists(boxCfg))) {
      const now    = Math.floor(Date.now() / 1000);
      const start = now;
      const end   = now + 86_400;

      const ix = buildIx("create_box", {
        platform:        { pubkey: platform,  isSigner: false, isWritable: false },
        project:         { pubkey: project,   isSigner: false, isWritable: false },
        box_config:      { pubkey: boxCfg,    isSigner: false, isWritable: true  },
        tenant:          { pubkey: publicKey, isSigner: true,  isWritable: false },
        system_program:  { pubkey: SYS_PROG,  isSigner: false, isWritable: false },
      }, [
        SLUG, BOX_ID, 0n,
        [new PublicKey("So11111111111111111111111111111111111111112"), PublicKey.default, PublicKey.default],
        [0n, 0n, 0n],
        100, start, end,
      ]);
      const sig = await sendWithWallet(ix, publicKey, bh);
      logOk(`Box created — tx: ${sig}`);
    } else {
      logWarn("Box already created — skipping");
    }

    // ── Step 4 ──────────────────────────────────────────────────────────────────
    step(4, "create_prize_item");
    if (!(await ownedByProgram(prizeItem))) {
      if (await ppaExists(prizeItem)) {
        logWarn(`prize_item at ${prizeItem.toBase58().slice(0,8)} exists but NOT owned by mystery_box`);
      }
      const bh4 = (await retryWithBackoff(() => conn.getLatestBlockhash(), "bh(step4)")).blockhash;
      const ix = buildIx("create_prize_item", {
        platform:        { pubkey: platform,  isSigner: false, isWritable: false },
        project:         { pubkey: project,   isSigner: false, isWritable: false },
        box_config:      { pubkey: boxCfg,    isSigner: false, isWritable: false },
        prize_item:      { pubkey: prizeItem, isSigner: false, isWritable: true  },
        vault:           { pubkey: vault,     isSigner: false, isWritable: false },
        tenant:          { pubkey: publicKey, isSigner: true,  isWritable: false },
        system_program:  { pubkey: SYS_PROG,  isSigner: false, isWritable: false },
      }, [
        SLUG, BOX_ID, prizeIdx,
        PRIZE_TYPE,
        mint,
        PRIZE_AMOUNT, 100, PRIZE_COUNT,
      ]);
      const sig = await sendWithWallet(ix, publicKey, bh4);
      logOk(`Prize item created — tx: ${sig}`);
    } else {
      logWarn("Prize item already initialized — skipping");
    }

    // ── Step 5 ──────────────────────────────────────────────────────────────────
    step(5, "initialize_vault");
    if (!(await ppaExists(vault))) {
      const ix = buildIx("initialize_vault", {
        platform:        { pubkey: platform,  isSigner: false, isWritable: false },
        project:         { pubkey: project,   isSigner: false, isWritable: false },
        vault:           { pubkey: vault,     isSigner: false, isWritable: true  },
        tenant:          { pubkey: publicKey, isSigner: true,  isWritable: false },
        system_program:  { pubkey: SYS_PROG,  isSigner: false, isWritable: false },
      }, [SLUG]);
      const sig = await sendWithWallet(ix, publicKey, bh);
      logOk(`Vault initialized — tx: ${sig}`);
    } else {
      logWarn("Vault already initialized — skipping");
    }

    // ── Step 6 ──────────────────────────────────────────────────────────────────
    step(6, "deposit_prize  (ensure tenant ATA + fund)");
    {
      // Ensure tenant token account (native mint ATA) exists; skip vault PDA ATA (created by program)
      const bh6 = (await retryWithBackoff(() => conn.getLatestBlockhash(), "bh(step6)")).blockhash;
      await createNativeAta(publicKey, mint, kp, bh6);

      const bhDep = (await retryWithBackoff(() => conn.getLatestBlockhash(), "bh(deposit)")).blockhash;
      const ix = buildIx("deposit_prize", {
        platform:               { pubkey: platform,            isSigner: false, isWritable: false },
        project:                { pubkey: project,             isSigner: false, isWritable: false },
        box_config:              { pubkey: boxCfg,             isSigner: false, isWritable: true  },
        prize_item:              { pubkey: prizeItem,          isSigner: false, isWritable: true  },
        vault:                   { pubkey: vault,              isSigner: false, isWritable: false },
        token_mint:              { pubkey: mint,               isSigner: false, isWritable: false },
        tenant_token_account:    { pubkey: tenantAta,          isSigner: false, isWritable: true  },
        vault_token_account:     { pubkey: vaultAta,           isSigner: false, isWritable: true  },
        tenant:                  { pubkey: publicKey,          isSigner: true,  isWritable: false },
        token_program:           { pubkey: TOKEN_PROG,         isSigner: false, isWritable: false },
        associated_token_program:{ pubkey: ATA_PROG,           isSigner: false, isWritable: false },
        system_program:          { pubkey: SYS_PROG,           isSigner: false, isWritable: false },
      }, [
        SLUG, prizeIdx, BOX_ID, DEPOSIT_TOTAL,
      ]);
      const sig = await sendWithWallet(ix, publicKey, bhDep);
      logOk(`Deposit succeeded — tx: ${sig}`);
    }

    // ── Step 7 ──────────────────────────────────────────────────────────────────
    step(7, "fast-forward end_time + withdraw_prize");
    {
      const now   = Math.floor(Date.now() / 1000);
      const past  = now - 3600;

      const bhUpd = (await retryWithBackoff(() => conn.getLatestBlockhash(), "bh(update_box)")).blockhash;
      const ixUpdate = buildIx("update_box", {
        project:         { pubkey: project,   isSigner: false, isWritable: false },
        box_config:      { pubkey: boxCfg,    isSigner: false, isWritable: true  },
        tenant:          { pubkey: publicKey, isSigner: true,  isWritable: false },
      }, [
        SLUG, BOX_ID, 0n,
        [mint, PublicKey.default, PublicKey.default],
        [0n, 0n, 0n],
        now - 86400, past,
      ]);
      const sigUpd = await sendWithWallet(ixUpdate, publicKey, bhUpd);
      logOk(`end_time updated — tx: ${sigUpd}`);

      const bhWdr = (await retryWithBackoff(() => conn.getLatestBlockhash(), "bh(withdraw)")).blockhash;
      const ixWithdraw = buildIx("withdraw_prize", {
        platform:               { pubkey: platform,            isSigner: false, isWritable: false },
        project:                { pubkey: project,             isSigner: false, isWritable: false },
        box_config:              { pubkey: boxCfg,             isSigner: false, isWritable: false },
        prize_item:              { pubkey: prizeItem,          isSigner: false, isWritable: true  },
        vault:                   { pubkey: vault,              isSigner: false, isWritable: false },
        token_mint:              { pubkey: mint,               isSigner: false, isWritable: false },
        vault_token_account:     { pubkey: vaultAta,           isSigner: false, isWritable: true  },
        tenant_token_account:    { pubkey: tenantAta,          isSigner: false, isWritable: true  },
        tenant:                  { pubkey: publicKey,          isSigner: true,  isWritable: false },
        token_program:           { pubkey: TOKEN_PROG,         isSigner: false, isWritable: false },
        associated_token_program:{ pubkey: ATA_PROG,           isSigner: false, isWritable: false },
        system_program:          { pubkey: SYS_PROG,           isSigner: false, isWritable: false },
      }, [
        SLUG, BOX_ID, prizeIdx,
      ]);
      const sigW = await sendWithWallet(ixWithdraw, publicKey, bhWdr);
      logOk(`Prize withdrawn — tx: ${sigW}`);

      const balAfter = await retryWithBackoff(() => conn.getBalance(publicKey), "getBalance(after_withdraw)");
      logOk(`Wallet balance: ${(balAfter / 1e9).toFixed(6)} SOL`);
    }

    console.log("\n\x1b[32m All steps passed. Fox deposit/withdraw E2E ✅\x1b[0m\n");
  } catch (e: any) {
    logErr(e?.message || e?.toString() || String(e));
    if (e?.logs)   console.error("Program logs:",  e.logs);
    if (e?.detail) console.error("Detail:",        e.detail);
    if (e?.name)   console.error("Error class:",   e.name);
    process.exit(1);
  }
}

main();
