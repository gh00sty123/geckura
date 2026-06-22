import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, Connection, Transaction } from "@solana/web3.js";
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";
import { expect } from "chai";

// Import the IDL types if they exist or compile program
import { MysteryBox } from "../target/types/mystery_box";

describe("mystery_box", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MysteryBox as Program<MysteryBox>;
  const connection = provider.connection;

  // The super admin key must match FBPFAtDxCwPEKb5kUp779TdFQU3hyPmfjT2LwtrkKscq
  const superAdmin = provider.wallet as anchor.Wallet;

  // PDAs
  let platformPda: PublicKey;
  let platformBump: number;

  const slug = "test-project-" + Math.floor(Math.random() * 100000);
  let projectPda: PublicKey;
  let projectBump: number;

  let vaultPda: PublicKey;
  let vaultBump: number;

  const boxId = new anchor.BN(1);
  let boxConfigPda: PublicKey;
  let boxConfigBump: number;

  const prizeIndex = 0;
  let prizeItemPda: PublicKey;
  let prizeItemBump: number;

  let receiptPda: PublicKey;
  let receiptBump: number;

  // Keys & Mint
  const tenant = Keypair.generate();
  const user = Keypair.generate();
  const feeWallet = Keypair.generate();
  const feeWallet2 = Keypair.generate();
  const platformTreasury = Keypair.generate();

  let tokenMint: PublicKey;
  let tenantTokenAccount: any;
  let vaultTokenAccount: any;
  let userTokenAccount: any;

  before(async () => {
    // Derive Platform PDA
    [platformPda, platformBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("platform")],
      program.programId
    );

    // Derive Project PDA
    [projectPda, projectBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("project"), Buffer.from(slug)],
      program.programId
    );

    // Derive Vault PDA
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), projectPda.toBuffer()],
      program.programId
    );

    // Derive BoxConfig PDA
    [boxConfigPda, boxConfigBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("box"), projectPda.toBuffer(), boxId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // Derive PrizeItem PDA
    [prizeItemPda, prizeItemBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("prize"), boxConfigPda.toBuffer(), Buffer.from([prizeIndex])],
      program.programId
    );

    // Derive BoxReceipt PDA
    [receiptPda, receiptBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), user.publicKey.toBuffer(), boxConfigPda.toBuffer()],
      program.programId
    );

    // Airdrop SOL to accounts
    const signature1 = await connection.requestAirdrop(tenant.publicKey, 2 * 1e9);
    await connection.confirmTransaction(signature1, "confirmed");

    const signature2 = await connection.requestAirdrop(user.publicKey, 2 * 1e9);
    await connection.confirmTransaction(signature2, "confirmed");

    const signature3 = await connection.requestAirdrop(feeWallet.publicKey, 1e8);
    await connection.confirmTransaction(signature3, "confirmed");

    const signature4 = await connection.requestAirdrop(feeWallet2.publicKey, 1e8);
    await connection.confirmTransaction(signature4, "confirmed");

    // Create custom test token mint
    tokenMint = await createMint(
      connection,
      tenant, // payer
      tenant.publicKey, // mintAuthority
      null, // freezeAuthority
      9 // decimals
    );

    // Create Associated Token Accounts (ATA)
    tenantTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tenant, // payer
      tokenMint,
      tenant.publicKey
    );

    vaultTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tenant, // payer
      tokenMint,
      vaultPda,
      true // allowOwnerOffCurve (PDA owner)
    );

    userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tenant, // payer
      tokenMint,
      user.publicKey
    );

    // Mint test tokens to tenant
    await mintTo(
      connection,
      tenant,
      tokenMint,
      tenantTokenAccount.address,
      tenant,
      50_000_000_000 // Mint 50 tokens (since decimals=9)
    );
  });

  it("Initializes the platform Config", async () => {
    await program.methods
      .initializePlatform(platformTreasury.publicKey)
      .accounts({
        platform: platformPda,
        superAdmin: superAdmin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const platformAccount = await program.account.platformConfig.fetch(platformPda);
    expect(platformAccount.authority.toBase58()).to.equal(superAdmin.publicKey.toBase58());
    expect(platformAccount.treasury.toBase58()).to.equal(platformTreasury.publicKey.toBase58());
    expect(platformAccount.isPaused).to.be.false;
  });

  it("Creates a project", async () => {
    const feeLamports = new anchor.BN(5_000_000); // 0.005 SOL fee
    const rentClaimMode = 0;

    await program.methods
      .createProject(
        slug,
        tenant.publicKey,
        feeWallet.publicKey,
        feeWallet2.publicKey,
        feeLamports,
        rentClaimMode
      )
      .accounts({
        platform: platformPda,
        project: projectPda,
        superAdmin: superAdmin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const projectAccount = await program.account.project.fetch(projectPda);
    expect(projectAccount.slug).to.equal(slug);
    expect(projectAccount.authority.toBase58()).to.equal(tenant.publicKey.toBase58());
    expect(projectAccount.feeWallet.toBase58()).to.equal(feeWallet.publicKey.toBase58());
    expect(projectAccount.feeWallet2.toBase58()).to.equal(feeWallet2.publicKey.toBase58());
    expect(projectAccount.feeLamports.toNumber()).to.equal(5_000_000);
    expect(projectAccount.isActive).to.be.true;
  });

  it("Initializes the prize vault PDA", async () => {
    await program.methods
      .initializeVault(slug)
      .accounts({
        project: projectPda,
        vault: vaultPda,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    const vaultAccount = await program.account.prizeVault.fetch(vaultPda);
    expect(vaultAccount.project.toBase58()).to.equal(projectPda.toBase58());
  });

  it("Creates a box config", async () => {
    const priceLamports = new anchor.BN(100_000_000); // 0.1 SOL
    const acceptedMints = [PublicKey.default, PublicKey.default, PublicKey.default];
    const acceptedPrices = [new anchor.BN(0), new anchor.BN(0), new anchor.BN(0)];
    const supply = 10;
    const startTime = new anchor.BN(Math.floor(Date.now() / 1000) - 100);
    const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + 10000);

    await program.methods
      .createBox(
        slug,
        boxId,
        priceLamports,
        acceptedMints,
        acceptedPrices,
        supply,
        startTime,
        endTime
      )
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    const boxAccount = await program.account.boxConfig.fetch(boxConfigPda);
    expect(boxAccount.project.toBase58()).to.equal(projectPda.toBase58());
    expect(boxAccount.boxId.toNumber()).to.equal(1);
    expect(boxAccount.supply).to.equal(10);
    expect(boxAccount.sold).to.equal(0);
  });

  it("Creates a prize item inside the box config", async () => {
    const prizeType = { splToken: {} }; // PrizeType::SplToken enum representation
    const amount = new anchor.BN(1_000_000_000); // 1 token (decimals=9)
    const winPercentage = 100; // Guaranteed win to simplify test verification
    const totalCount = 10;

    await program.methods
      .createPrizeItem(
        slug,
        boxId,
        prizeIndex,
        prizeType,
        tokenMint,
        amount,
        winPercentage,
        totalCount
      )
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda,
        prizeItem: prizeItemPda,
        tenant: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    const prizeAccount = await program.account.prizeItem.fetch(prizeItemPda);
    expect(prizeAccount.boxConfig.toBase58()).to.equal(boxConfigPda.toBase58());
    expect(prizeAccount.index).to.equal(prizeIndex);
    expect(prizeAccount.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
    expect(prizeAccount.amount.toNumber()).to.equal(1_000_000_000);
    expect(prizeAccount.winPercentage).to.equal(100);
    expect(prizeAccount.totalCount).to.equal(10);
  });

  it("Deposits the SPL prize tokens into the vault PDA", async () => {
    const amount = new anchor.BN(10_000_000_000); // 10 tokens (required: amount * totalCount = 1 token * 10 count = 10 tokens)

    await program.methods
      .depositPrize(slug, prizeIndex, boxId, amount)
      .accounts({
        project: projectPda,
        boxConfig: boxConfigPda,
        prizeItem: prizeItemPda,
        vault: vaultPda,
        tokenMint: tokenMint,
        tenantTokenAccount: tenantTokenAccount.address,
        vaultTokenAccount: vaultTokenAccount.address,
        tenant: tenant.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([tenant])
      .rpc();

    const vaultTokenBalance = await connection.getTokenAccountBalance(vaultTokenAccount.address);
    expect(vaultTokenBalance.value.amount).to.equal("10000000000");
  });

  it("Buys a box using SOL and creates a receipt account", async () => {
    const quantity = 1;
    const initialUserSol = await connection.getBalance(user.publicKey);
    const initialTenantSol = await connection.getBalance(tenant.publicKey);

    await program.methods
      .buyBox(slug, boxId, quantity)
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda,
        receipt: receiptPda,
        user: user.publicKey,
        feeWallet: feeWallet.publicKey,
        feeWallet2: feeWallet2.publicKey,
        tenantWallet: tenant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const receiptAccount = await program.account.boxReceipt.fetch(receiptPda);
    expect(receiptAccount.user.toBase58()).to.equal(user.publicKey.toBase58());
    expect(receiptAccount.boxConfig.toBase58()).to.equal(boxConfigPda.toBase58());
    expect(receiptAccount.purchased).to.equal(1);
    expect(receiptAccount.pendingOpens).to.equal(0);

    const boxAccount = await program.account.boxConfig.fetch(boxConfigPda);
    expect(boxAccount.sold).to.equal(1);

    // Verify payments were transferred
    const finalTenantSol = await connection.getBalance(tenant.publicKey);
    expect(finalTenantSol).to.be.greaterThan(initialTenantSol); // Should get price (100,000,000 lamports)
  });

  it("Submits a RequestOpen to open the box", async () => {
    const quantity = 1;

    await program.methods
      .requestOpen(slug, boxId, quantity)
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda,
        receipt: receiptPda,
        user: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const receiptAccount = await program.account.boxReceipt.fetch(receiptPda);
    expect(receiptAccount.purchased).to.equal(0);
    expect(receiptAccount.pendingOpens).to.equal(1);
    expect(receiptAccount.requestSlot.toNumber()).to.be.greaterThan(0);
  });

  it("Reveals the open request and transfers the SPL prize to the user", async () => {
    // Generate dummy transactions to advance slots on local validator so reveal slot > request slot
    // This is required to pass theSameSlotReveal check on-chain.
    const temp = Keypair.generate();
    for (let i = 0; i < 3; i++) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: user.publicKey,
          toPubkey: temp.publicKey,
          lamports: 1000,
        })
      );
      await provider.sendAndConfirm(tx, [user]);
    }

    const SYSVAR_SLOT_HASHES_PUBKEY = new PublicKey("SysvarS1otHashes111111111111111111111111111");

    await program.methods
      .revealOpen(slug, boxId)
      .accounts({
        platform: platformPda,
        project: projectPda,
        boxConfig: boxConfigPda,
        receipt: receiptPda,
        vault: vaultPda,
        user: user.publicKey,
        keeper: superAdmin.publicKey,
        systemProgram: SystemProgram.programId,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        vaultTokenAccount: vaultTokenAccount.address,
        userTokenAccount: userTokenAccount.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts([
        {
          pubkey: prizeItemPda,
          isSigner: false,
          isWritable: true,
        }
      ])
      .rpc();

    const receiptAccount = await program.account.boxReceipt.fetch(receiptPda);
    expect(receiptAccount.pendingOpens).to.equal(0);
    expect(receiptAccount.totalOpened).to.equal(1);

    const userTokenBalance = await connection.getTokenAccountBalance(userTokenAccount.address);
    expect(userTokenBalance.value.amount).to.equal("1000000000"); // 1 prize token transferred!
  });
});
