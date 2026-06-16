use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::SysvarId;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use sha2::{Digest, Sha256};

use crate::errors::MysteryBoxError;
use crate::state::{
    BoxConfig, BoxOpenEvent, BoxReceipt, BoxStatus, PlatformConfig, PrizeType,
    PrizeVault, Project, BOX_SEED, MAX_BOXES_PER_TX, PLATFORM_SEED, PROJECT_SEED,
    RECEIPT_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(slug: String, box_id: u64, quantity: u8)]
pub struct BuyBox<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump = box_config.bump
    )]
    pub box_config: Account<'info, BoxConfig>,
    #[account(
        init_if_needed,
        payer = user,
        space = BoxReceipt::SPACE,
        seeds = [RECEIPT_SEED, user.key().as_ref(), box_config.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, BoxReceipt>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: fee wallet receives SOL only
    #[account(mut, address = project.fee_wallet)]
    pub fee_wallet: UncheckedAccount<'info>,
    /// CHECK: tenant wallet receives SOL only
    #[account(mut, address = project.authority)]
    pub tenant_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(slug: String, box_id: u64, quantity: u32)]
pub struct RequestOpen<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump = box_config.bump
    )]
    pub box_config: Account<'info, BoxConfig>,
    #[account(
        mut,
        seeds = [RECEIPT_SEED, user.key().as_ref(), box_config.key().as_ref()],
        bump = receipt.bump
    )]
    pub receipt: Account<'info, BoxReceipt>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(slug: String, box_id: u64)]
pub struct RevealOpen<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump = box_config.bump
    )]
    pub box_config: Account<'info, BoxConfig>,
    #[account(
        mut,
        seeds = [RECEIPT_SEED, user.key().as_ref(), box_config.key().as_ref()],
        bump = receipt.bump
    )]
    pub receipt: Account<'info, BoxReceipt>,
    #[account(
        mut,
        seeds = [VAULT_SEED, project.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, PrizeVault>,
    /// CHECK: user is NOT a signer, so that the keeper/crank can submit this transaction.
    /// We verify the user key matches the stored user in the receipt PDA.
    #[account(mut, address = receipt.user)]
    pub user: UncheckedAccount<'info>,
    #[account(mut)]
    pub keeper: Signer<'info>, // Crank/bot paying transaction fee
    pub system_program: Program<'info, System>,
    /// CHECK: SlotHashes sysvar for fetching the committed slot blockhash
    #[account(address = SlotHashes::id())]
    pub slot_hashes: UncheckedAccount<'info>,
    
    // Optional token accounts for NFT/SPL token transfers
    /// CHECK: Optional vault token account (if prize is SplToken/Nft)
    #[account(mut)]
    pub vault_token_account: Option<Account<'info, TokenAccount>>,
    /// CHECK: Optional user token account (if prize is SplToken/Nft)
    #[account(mut)]
    pub user_token_account: Option<Account<'info, TokenAccount>>,
    pub token_program: Option<Program<'info, Token>>,
}

pub fn buy_box(
    ctx: Context<BuyBox>,
    _slug: String,
    _box_id: u64,
    quantity: u8,
) -> Result<()> {
    let platform = &ctx.accounts.platform;
    let project = &ctx.accounts.project;
    let box_config = &mut ctx.accounts.box_config;
    let receipt = &mut ctx.accounts.receipt;
    let user = &ctx.accounts.user;

    if receipt.user == Pubkey::default() {
        receipt.user = user.key();
        receipt.box_config = box_config.key();
        receipt.purchased = 0;
        receipt.total_opened = 0;
        receipt.nonce = 0;
        receipt.bump = ctx.bumps.receipt;
    }

    require!(quantity > 0 && quantity <= MAX_BOXES_PER_TX, MysteryBoxError::BoxSoldOut);
    require!(!platform.is_paused, MysteryBoxError::PlatformPaused);
    require!(project.is_active, MysteryBoxError::ProjectInactive);
    require!(
        box_config.status == BoxStatus::Active,
        MysteryBoxError::BoxNotActive
    );

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!(
        now >= box_config.start_time,
        MysteryBoxError::BoxNotActive
    );
    require!(
        now <= box_config.end_time,
        MysteryBoxError::BoxAlreadyEnded
    );

    let remaining = box_config.supply
        .checked_sub(box_config.sold)
        .ok_or(MysteryBoxError::MathOverflow)?;
    require!(remaining >= quantity as u32, MysteryBoxError::BoxSoldOut);

    let total_price = box_config
        .price_lamports
        .checked_mul(quantity as u64)
        .ok_or(MysteryBoxError::InsufficientPayment)?;

    let total_fee = project
        .fee_lamports
        .checked_mul(quantity as u64)
        .ok_or(MysteryBoxError::InsufficientPayment)?;

    let tenant_amount = total_price;

    if total_fee > 0 {
        let cpi_fee = CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: user.to_account_info(),
                to: ctx.accounts.fee_wallet.to_account_info(),
            },
        );
        system_program::transfer(cpi_fee, total_fee)?;
    }

    if tenant_amount > 0 {
        let cpi_tenant = CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: user.to_account_info(),
                to: ctx.accounts.tenant_wallet.to_account_info(),
            },
        );
        system_program::transfer(cpi_tenant, tenant_amount)?;
    }

    box_config.sold = box_config.sold
        .checked_add(quantity as u32)
        .ok_or(MysteryBoxError::MathOverflow)?;
    receipt.purchased = receipt.purchased
        .checked_add(quantity as u32)
        .ok_or(MysteryBoxError::MathOverflow)?;

    if box_config.sold >= box_config.supply {
        box_config.status = BoxStatus::Ended;
    }

    Ok(())
}

pub fn request_open(
    ctx: Context<RequestOpen>,
    _slug: String,
    _box_id: u64,
    quantity: u32,
) -> Result<()> {
    let platform = &ctx.accounts.platform;
    let project = &ctx.accounts.project;
    let receipt = &mut ctx.accounts.receipt;

    require!(!platform.is_paused, MysteryBoxError::PlatformPaused);
    require!(project.is_active, MysteryBoxError::ProjectInactive);

    require!(quantity > 0, MysteryBoxError::Unauthorized);
    require!(receipt.purchased >= quantity, MysteryBoxError::NoPurchasedBoxes);
    require!(receipt.pending_opens == 0, MysteryBoxError::AlreadyPendingReveal);

    receipt.purchased = receipt.purchased.saturating_sub(quantity);
    receipt.pending_opens = quantity;
    receipt.request_slot = Clock::get()?.slot;

    Ok(())
}

pub fn reveal_open(
    ctx: Context<RevealOpen>,
    _slug: String,
    _box_id: u64,
) -> Result<()> {
    let platform = &ctx.accounts.platform;
    let project = &ctx.accounts.project;
    let box_config = &mut ctx.accounts.box_config;
    let receipt = &mut ctx.accounts.receipt;
    let vault = &ctx.accounts.vault;
    let user = &ctx.accounts.user;

    require!(!platform.is_paused, MysteryBoxError::PlatformPaused);
    require!(project.is_active, MysteryBoxError::ProjectInactive);
    require!(receipt.pending_opens > 0, MysteryBoxError::NoPendingReveal);

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Verify commit and reveal happen in different slots
    require!(
        clock.slot > receipt.request_slot,
        MysteryBoxError::SameSlotReveal
    );
    require!(
        clock.slot.saturating_sub(receipt.request_slot) < 512,
        MysteryBoxError::RequestExpired
    );

    // Fetch the slot hash of the committed slot
    let slot_hashes_data = ctx.accounts.slot_hashes.try_borrow_data()?;
    let request_hash = get_slot_hash(&slot_hashes_data, receipt.request_slot)?;

    // Derive randomness using FNV-1a
    let mut hash_input = [0u8; 112];
    hash_input[0..32].copy_from_slice(user.key().as_ref());
    hash_input[32..64].copy_from_slice(&request_hash);
    hash_input[64..96].copy_from_slice(box_config.key().as_ref());
    hash_input[96..104].copy_from_slice(&receipt.nonce.to_le_bytes());
    hash_input[104..112].copy_from_slice(&receipt.request_slot.to_le_bytes());

    let mut hasher = Sha256::new();
    hasher.update(&hash_input);
    let hash_result = hasher.finalize();
    let random_u64 = u64::from_le_bytes(hash_result[0..8].try_into().unwrap());

    let mut is_winner = false;
    let mut won_prize: Option<crate::state::PrizeItem> = None;

    let mut total_weight = 0u64;
    let mut guaranteed_prize: Option<crate::state::PrizeItem> = None;

    // Load and validate dynamic PrizeItem accounts passed as remaining accounts
    let remaining_accounts = ctx.remaining_accounts;
    for account_info in remaining_accounts.iter() {
        let prize_item = crate::state::PrizeItem::try_deserialize(&mut &**account_info.try_borrow_data()?)?;

        // Validate PDA derivation of the PrizeItem
        let derived_pda = Pubkey::create_program_address(
            &[
                crate::state::PRIZE_SEED,
                box_config.key().as_ref(),
                &[prize_item.index],
                &[prize_item.bump],
            ],
            ctx.program_id,
        ).map_err(|_| MysteryBoxError::Unauthorized)?;

        require_keys_eq!(account_info.key(), derived_pda, MysteryBoxError::Unauthorized);
        require_keys_eq!(prize_item.box_config, box_config.key(), MysteryBoxError::Unauthorized);

        let idx = prize_item.index as usize;
        if idx < 20 {
            let claimed = box_config.claimed_prizes[idx];
            let rem = prize_item.total_count.saturating_sub(claimed);
            if rem > 0 {
                total_weight = total_weight.saturating_add(prize_item.win_percentage as u64);
                if prize_item.win_percentage == 100 {
                    guaranteed_prize = Some(prize_item);
                }
            }
        }
    }

    let mut amount_won: u64 = 0;
    let mut prize_type = PrizeType::Sol;
    let mut token_mint = Pubkey::default();
    let mut prize_index: u8 = 0;

    // First check if there's a guaranteed 100% win prize!
    if let Some(prize) = guaranteed_prize {
        is_winner = true;
        won_prize = Some(prize);
    } else if total_weight > 0 {
        let prize_roll = random_u64 % total_weight;
        let mut cumulative = 0u64;

        for account_info in remaining_accounts.iter() {
            let prize_item = crate::state::PrizeItem::try_deserialize(&mut &**account_info.try_borrow_data()?)?;
            let idx = prize_item.index as usize;
            if idx < 20 {
                let claimed = box_config.claimed_prizes[idx];
                let rem = prize_item.total_count.saturating_sub(claimed);
                if rem > 0 {
                    cumulative = cumulative.saturating_add(prize_item.win_percentage as u64);
                    if prize_roll < cumulative {
                        is_winner = true; // ALWAYS win if you pick a prize!
                        won_prize = Some(prize_item);
                        break;
                    }
                }
            }
        }
    }

    if is_winner && won_prize.is_some() {
        let prize = won_prize.unwrap();
        prize_type = prize.prize_type;
        token_mint = prize.token_mint;
        prize_index = prize.index;
        amount_won = prize.amount;

        let idx = prize.index as usize;
        if idx < 20 {
            box_config.claimed_prizes[idx] = box_config.claimed_prizes[idx]
                .checked_add(1)
                .ok_or(MysteryBoxError::MathOverflow)?;
        }
        box_config.total_claimed = box_config.total_claimed
            .checked_add(1)
            .ok_or(MysteryBoxError::MathOverflow)?;

        match prize.prize_type {
            PrizeType::Sol => {
                let vault_lamports = vault.to_account_info().lamports();
                require!(vault_lamports >= amount_won, MysteryBoxError::InsufficientFunds);

                **vault.to_account_info().try_borrow_mut_lamports()? = vault_lamports
                    .checked_sub(amount_won)
                    .ok_or(MysteryBoxError::MathOverflow)?;

                **user.to_account_info().try_borrow_mut_lamports()? = user.to_account_info().lamports()
                    .checked_add(amount_won)
                    .ok_or(MysteryBoxError::MathOverflow)?;
            }
            PrizeType::SplToken | PrizeType::Nft => {
                require!(
                    ctx.accounts.vault_token_account.is_some() &&
                    ctx.accounts.user_token_account.is_some() &&
                    ctx.accounts.token_program.is_some(),
                    MysteryBoxError::InsufficientFunds
                );

                let vault_token_acc = ctx.accounts.vault_token_account.as_ref().unwrap();
                let user_token_acc = ctx.accounts.user_token_account.as_ref().unwrap();
                let token_program = ctx.accounts.token_program.as_ref().unwrap();

                require!(
                    vault_token_acc.mint == prize.token_mint,
                    MysteryBoxError::InvalidMint
                );
                require!(
                    user_token_acc.mint == prize.token_mint,
                    MysteryBoxError::InvalidMint
                );
                require!(
                    vault_token_acc.amount >= amount_won,
                    MysteryBoxError::InsufficientFunds
                );
                // Validate token account ownership
                require!(
                    vault_token_acc.owner == vault.key(),
                    MysteryBoxError::Unauthorized
                );
                require!(
                    user_token_acc.owner == user.key(),
                    MysteryBoxError::Unauthorized
                );

                let cpi_ctx = CpiContext::new(
                    token_program.key(),
                    Transfer {
                        from: vault_token_acc.to_account_info(),
                        to: user_token_acc.to_account_info(),
                        authority: vault.to_account_info(),
                    },
                );

                let project_key = ctx.accounts.project.key();
                let seeds = &[
                    VAULT_SEED,
                    project_key.as_ref(),
                    &[ctx.accounts.vault.bump],
                ];
                let signer = &[&seeds[..]];

                token::transfer(cpi_ctx.with_signer(signer), amount_won)?;
            }
        }
    }

    box_config.total_opened = box_config.total_opened
        .checked_add(1)
        .ok_or(MysteryBoxError::MathOverflow)?;
    receipt.pending_opens = receipt.pending_opens
        .checked_sub(1)
        .ok_or(MysteryBoxError::MathOverflow)?;
    receipt.total_opened = receipt.total_opened
        .checked_add(1)
        .ok_or(MysteryBoxError::MathOverflow)?;
    
    if box_config.sold >= box_config.supply {
        box_config.status = BoxStatus::Ended;
    }
    receipt.nonce = receipt.nonce.wrapping_add(1);

    if receipt.pending_opens == 0 {
        receipt.request_slot = 0;
    }

    emit!(BoxOpenEvent {
        box_config: box_config.key(),
        user: user.key(),
        prize_index,
        slot: clock.slot,
        nonce: receipt.nonce,
        roll: random_u64 % 100,
        won: is_winner,
        prize_type,
        token_mint,
        amount_won,
        timestamp: now,
    });

    Ok(())
}

fn get_slot_hash(slot_hashes_data: &[u8], target_slot: u64) -> Result<[u8; 32]> {
    if slot_hashes_data.len() < 8 {
        return Err(error!(MysteryBoxError::SlotHashNotFound));
    }
    let len = u64::from_le_bytes(slot_hashes_data[0..8].try_into().unwrap()) as usize;
    for i in 0..len {
        let start = 8 + i * 40;
        if start + 40 > slot_hashes_data.len() {
            break;
        }
        let entry_slot = u64::from_le_bytes(slot_hashes_data[start..start + 8].try_into().unwrap());
        if entry_slot == target_slot {
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&slot_hashes_data[start + 8..start + 40]);
            return Ok(hash);
        }
    }
    Err(error!(MysteryBoxError::SlotHashNotFound))
}
