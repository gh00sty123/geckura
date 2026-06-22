use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::errors::MysteryBoxError;
use crate::state::{
    BoxConfig, BoxStatus, PlatformConfig, PrizeItem, PrizeType, PrizeVault, Project, BOX_SEED,
    PLATFORM_SEED, PRIZE_SEED, PROJECT_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(slug: String)]
pub struct InitializeVault<'info> {
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        init,
        payer = tenant,
        space = PrizeVault::SPACE,
        seeds = [VAULT_SEED, project.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, PrizeVault>,
    #[account(mut)]
    pub tenant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(slug: String, box_id: u64, prize_index: u8)]
pub struct CreatePrizeItem<'info> {
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    /// CHECK: box_config PDA validated by seeds below
    #[account(
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump
    )]
    pub box_config: UncheckedAccount<'info>,
    #[account(
        init,
        payer = tenant,
        space = PrizeItem::SPACE,
        seeds = [PRIZE_SEED, box_config.key().as_ref(), &[prize_index]],
        bump
    )]
    pub prize_item: Account<'info, PrizeItem>,
    #[account(mut)]
    pub tenant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Unique instruction args `(slug, prize_index, box_id)` — distinct from
/// `CreatePrizeItem(slug, box_id, prize_index)` to avoid duplicate `#[instruction]` macro constants.
#[derive(Accounts)]
#[instruction(slug: String, prize_index: u8, box_id: u64)]
pub struct DepositPrize<'info> {
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    /// CHECK: box_config PDA validated by seeds below
    #[account(
        mut,
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump
    )]
    pub box_config: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [PRIZE_SEED, box_config.key().as_ref(), &[prize_index]],
        bump = prize_item.bump
    )]
    pub prize_item: Account<'info, PrizeItem>,
    /// CHECK: vault PDA validated by seeds below
    #[account(
        seeds = [VAULT_SEED, project.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = tenant
    )]
    pub tenant_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub tenant: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Unique instruction args `(slug, prize_index, box_id)` — distinct from
/// `DepositPrize(slug, prize_index, box_id)` by the order of `box_id` in the withdrawal branch
/// vs deposit branch; the struct type itself is already distinct but the instruction name
/// (`withdraw_prize`) allows reusing the same signature as `DepositPrize` with no macro conflict.
#[derive(Accounts)]
#[instruction(slug: String, box_id: u64, prize_index: u8)]
pub struct WithdrawPrize<'info> {
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    /// CHECK: box_config PDA validated by seeds below
    #[account(
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump = box_config.bump
    )]
    pub box_config: Account<'info, BoxConfig>,
    #[account(
        mut,
        seeds = [PRIZE_SEED, box_config.key().as_ref(), &[prize_index]],
        bump = prize_item.bump
    )]
    pub prize_item: Account<'info, PrizeItem>,
    /// CHECK: vault PDA validated by seeds below
    #[account(
        seeds = [VAULT_SEED, project.key().as_ref()],
        bump
    )]
    pub vault: UncheckedAccount<'info>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = tenant
    )]
    pub tenant_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub tenant: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_vault(ctx: Context<InitializeVault>, _slug: String) -> Result<()> {
    let project = &ctx.accounts.project;
    // Authorization: only project authority can initialize vault
    require_keys_eq!(
        ctx.accounts.tenant.key(),
        project.authority,
        MysteryBoxError::Unauthorized
    );
    let vault = &mut ctx.accounts.vault;
    vault.project = project.key();
    vault.bump = ctx.bumps.vault;
    Ok(())
}

pub fn create_prize_item(
    ctx: Context<CreatePrizeItem>,
    _slug: String,
    _box_id: u64,
    _prize_index: u8,
    prize_type: PrizeType,
    token_mint: Pubkey,
    amount: u64,
    win_percentage: u8,
    total_count: u32,
) -> Result<()> {
    // Authorization: only project authority can create prize items
    require_keys_eq!(
        ctx.accounts.tenant.key(),
        ctx.accounts.project.authority,
        MysteryBoxError::Unauthorized
    );
    // Validate win percentage range
    require!(win_percentage <= 100, MysteryBoxError::InvalidWinPercentage);

    let prize_item = &mut ctx.accounts.prize_item;
    prize_item.box_config = ctx.accounts.box_config.key();
    prize_item.index = _prize_index;
    prize_item.prize_type = prize_type;
    prize_item.token_mint = token_mint;
    prize_item.amount = amount;
    prize_item.win_percentage = win_percentage;
    prize_item.total_count = total_count;
    prize_item.claimed_count = 0;
    prize_item.bump = ctx.bumps.prize_item;

    Ok(())
}

pub fn deposit_prize(
    ctx: Context<DepositPrize>,
    _slug: String,
    _prize_index: u8,
    _box_id: u64,
    amount: u64,
) -> Result<()> {
    // Authorization: only project authority can deposit prizes
    require_keys_eq!(
        ctx.accounts.tenant.key(),
        ctx.accounts.project.authority,
        MysteryBoxError::Unauthorized
    );
    let prize_item = &ctx.accounts.prize_item;

    require_keys_eq!(
        ctx.accounts.token_mint.key(),
        prize_item.token_mint,
        MysteryBoxError::InvalidMint
    );

    let required = prize_item
        .amount
        .checked_mul(prize_item.total_count as u64)
        .ok_or(MysteryBoxError::DepositMismatch)?;
    require!(amount == required, MysteryBoxError::DepositMismatch);

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.key(),
        token::Transfer {
            from: ctx.accounts.tenant_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.tenant.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, amount)?;

    Ok(())
}

pub fn withdraw_prize(
    ctx: Context<WithdrawPrize>,
    _slug: String,
    _box_id: u64,
    _prize_index: u8,
) -> Result<()> {
    // Authorization: only project authority can withdraw prizes
    require_keys_eq!(
        ctx.accounts.tenant.key(),
        ctx.accounts.project.authority,
        MysteryBoxError::Unauthorized
    );
    let box_config = &ctx.accounts.box_config;
    let prize_item = &ctx.accounts.prize_item;
    let vault = &ctx.accounts.vault;
    let project = &ctx.accounts.project;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    require!(
        box_config.status == BoxStatus::Ended || now > box_config.end_time,
        MysteryBoxError::BoxNotEnded
    );

    let unclaimed = prize_item
        .total_count
        .saturating_sub(prize_item.claimed_count);
    require!(unclaimed > 0, MysteryBoxError::NoPrizeClaimsRemaining);

    let withdraw_amount = prize_item
        .amount
        .checked_mul(unclaimed as u64)
        .ok_or(MysteryBoxError::DepositMismatch)?;

    let project_key = project.key();
    let seeds = &[VAULT_SEED, project_key.as_ref(), &[ctx.bumps.vault]];
    let signer = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        token::Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.tenant_token_account.to_account_info(),
            authority: vault.to_account_info(),
        },
        signer,
    );
    token::transfer(cpi_ctx, withdraw_amount)?;

    Ok(())
}

// ------------------------------------------------------------------
// 5. withdraw_vault_sol
// ------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(slug: String, amount: u64)]
pub struct WithdrawVaultSol<'info> {
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [VAULT_SEED, project.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, PrizeVault>,
    #[account(
        mut,
        address = project.authority @ MysteryBoxError::Unauthorized
    )]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn withdraw_vault_sol(ctx: Context<WithdrawVaultSol>, _slug: String, amount: u64) -> Result<()> {
    let vault_acc = &mut ctx.accounts.vault.to_account_info();
    let authority_acc = &mut ctx.accounts.authority.to_account_info();

    let vault_lamports = vault_acc.lamports();
    // Ensure vault remains rent-exempt after withdrawal (Rent-exempt minimum for 41 bytes)
    let min_balance = 1_176_240;
    require!(
        vault_lamports.checked_sub(amount).unwrap_or(0) >= min_balance,
        MysteryBoxError::InsufficientFunds
    );

    **vault_acc.try_borrow_mut_lamports()? = vault_lamports
        .checked_sub(amount)
        .ok_or(MysteryBoxError::MathOverflow)?;

    **authority_acc.try_borrow_mut_lamports()? = authority_acc
        .lamports()
        .checked_add(amount)
        .ok_or(MysteryBoxError::MathOverflow)?;

    Ok(())
}

// ------------------------------------------------------------------
// 6. withdraw_vault_token
// ------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(slug: String, amount: u64)]
pub struct WithdrawVaultToken<'info> {
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [VAULT_SEED, project.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, PrizeVault>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = authority
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = project.authority @ MysteryBoxError::Unauthorized
    )]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn withdraw_vault_token(ctx: Context<WithdrawVaultToken>, _slug: String, amount: u64) -> Result<()> {
    let project_key = ctx.accounts.project.key();
    let seeds = &[
        VAULT_SEED,
        project_key.as_ref(),
        &[ctx.accounts.vault.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        token::Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.authority_token_account.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
        },
        signer,
    );
    token::transfer(cpi_ctx, amount)?;

    Ok(())
}

// ------------------------------------------------------------------
// 7. close_prize_item
// ------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(slug: String, box_id: u64, prize_index: u8)]
pub struct ClosePrizeItem<'info> {
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
        seeds = [PRIZE_SEED, box_config.key().as_ref(), &[prize_index]],
        bump = prize_item.bump,
        close = rent_destination
    )]
    pub prize_item: Account<'info, PrizeItem>,
    pub signer: Signer<'info>,
    #[account(mut)]
    pub rent_destination: SystemAccount<'info>,
}

pub fn close_prize_item(
    ctx: Context<ClosePrizeItem>,
    _slug: String,
    _box_id: u64,
    _prize_index: u8,
) -> Result<()> {
    let box_config = &ctx.accounts.box_config;
    let project = &ctx.accounts.project;
    let platform = &ctx.accounts.platform;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let signer_key = ctx.accounts.signer.key();
    crate::state::validate_close_authority(
        signer_key,
        project.authority,
        platform.authority,
        project.rent_claim_mode,
        platform.treasury,
        ctx.accounts.rent_destination.key(),
    )?;

    // Ensure box is ended or sold out
    require!(
        box_config.status == BoxStatus::Ended || now > box_config.end_time || box_config.sold >= box_config.supply,
        MysteryBoxError::BoxNotEnded
    );

    Ok(())
}


