use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use crate::errors::MysteryBoxError;
use crate::state::{
    BoxConfig, BoxStatus, PlatformConfig, PrizeItem, PrizeType, PrizeVault, Project, BOX_SEED,
    PLATFORM_SEED, PROJECT_SEED, VAULT_SEED,
};

#[derive(Accounts)]
#[instruction(project_id: u64)]
pub struct InitializeVault<'info> {
    #[account(
        seeds = [PROJECT_SEED, &project_id.to_le_bytes()],
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
#[instruction(project_id: u64, box_id: u64)]
pub struct CreatePrizeItem<'info> {
    #[account(
        seeds = [PROJECT_SEED, &project_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        mut,
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump = box_config.bump
    )]
    pub box_config: Box<Account<'info, BoxConfig>>,
    #[account(mut)]
    pub tenant: Signer<'info>,
}

use crate::state::ManagePrizeAction;

#[derive(Accounts)]
#[instruction(project_id: u64, prize_index: u8, box_id: u64)]
pub struct ManagePrize<'info> {
    #[account(
        seeds = [PROJECT_SEED, &project_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Box<Account<'info, Project>>,
    #[account(
        mut,
        seeds = [BOX_SEED, project.key().as_ref(), &box_id.to_le_bytes()],
        bump = box_config.bump
    )]
    pub box_config: Box<Account<'info, BoxConfig>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, project.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, PrizeVault>>,
    pub token_mint: Account<'info, Mint>,
    #[account(mut)]
    pub tenant_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub tenant: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_vault(ctx: Context<InitializeVault>, _project_id: u64) -> Result<()> {
    let project = &ctx.accounts.project;
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
    _project_id: u64,
    _box_id: u64,
    prize_index: u8,
    prize_type: PrizeType,
    token_mint: Pubkey,
    amount: u64,
    win_percentage: u8,
    total_count: u32,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.tenant.key(),
        ctx.accounts.project.authority,
        MysteryBoxError::Unauthorized
    );
    require!(win_percentage <= 100, MysteryBoxError::InvalidWinPercentage);

    require!(prize_index < 20, MysteryBoxError::InvalidPrizeIndex);
    require!(prize_index == ctx.accounts.box_config.prizes_count, MysteryBoxError::InvalidPrizeIndex);

    let box_config = &mut ctx.accounts.box_config;
    box_config.prizes[prize_index as usize] = PrizeItem {
        index: prize_index,
        prize_type,
        token_mint,
        amount,
        win_percentage,
        total_count,
        claimed_count: 0,
    };
    box_config.prizes_count = box_config.prizes_count.checked_add(1).ok_or(MysteryBoxError::MathOverflow)?;

    Ok(())
}

pub fn manage_prize(
    ctx: Context<ManagePrize>,
    _project_id: u64,
    prize_index: u8,
    _box_id: u64,
    action: ManagePrizeAction,
    amount: u64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.tenant.key(),
        ctx.accounts.project.authority,
        MysteryBoxError::Unauthorized
    );

    let box_config = &mut ctx.accounts.box_config;
    require!((prize_index as usize) < (box_config.prizes_count as usize), MysteryBoxError::InvalidPrizeIndex);

    let box_status = box_config.status;
    let box_end_time = box_config.end_time;

    let prize_item = &mut box_config.prizes[prize_index as usize];

    require_keys_eq!(
        ctx.accounts.token_mint.key(),
        prize_item.token_mint,
        MysteryBoxError::InvalidMint
    );

    require_keys_eq!(ctx.accounts.tenant_token_account.mint, ctx.accounts.token_mint.key(), MysteryBoxError::InvalidMint);
    require_keys_eq!(ctx.accounts.tenant_token_account.owner, ctx.accounts.tenant.key(), MysteryBoxError::Unauthorized);
    require_keys_eq!(ctx.accounts.vault_token_account.mint, ctx.accounts.token_mint.key(), MysteryBoxError::InvalidMint);
    require_keys_eq!(ctx.accounts.vault_token_account.owner, ctx.accounts.vault.key(), MysteryBoxError::Unauthorized);

    match action {
        ManagePrizeAction::Deposit => {
            let required = prize_item
                .amount
                .checked_mul(prize_item.total_count as u64)
                .ok_or(MysteryBoxError::DepositMismatch)?;
            require!(amount == required, MysteryBoxError::DepositMismatch);

            let cpi_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.tenant_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.tenant.to_account_info(),
                },
            );
            token::transfer(cpi_ctx, amount)?;
        }
        ManagePrizeAction::Withdraw => {
            let vault = &ctx.accounts.vault;
            let project = &ctx.accounts.project;

            let clock = Clock::get()?;
            let now = clock.unix_timestamp;
            require!(
                box_status == BoxStatus::Ended || now > box_end_time,
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
            let seeds = &[VAULT_SEED, project_key.as_ref(), &[vault.bump]];
            let signer = &[&seeds[..]];

            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.tenant_token_account.to_account_info(),
                    authority: vault.to_account_info(),
                },
                signer,
            );
            token::transfer(cpi_ctx, withdraw_amount)?;
        }
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(project_id: u64, amount: u64)]
pub struct WithdrawVaultSol<'info> {
    #[account(
        seeds = [PROJECT_SEED, &project_id.to_le_bytes()],
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

pub fn withdraw_vault_sol(ctx: Context<WithdrawVaultSol>, _project_id: u64, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.project.active_boxes_count == 0,
        MysteryBoxError::ProjectHasActiveBoxes
    );

    let vault_acc = &mut ctx.accounts.vault.to_account_info();
    let authority_acc = &mut ctx.accounts.authority.to_account_info();

    let vault_lamports = vault_acc.lamports();
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

#[derive(Accounts)]
#[instruction(project_id: u64, amount: u64)]
pub struct WithdrawVaultToken<'info> {
    #[account(
        seeds = [PROJECT_SEED, &project_id.to_le_bytes()],
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
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = project.authority @ MysteryBoxError::Unauthorized
    )]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn withdraw_vault_token(ctx: Context<WithdrawVaultToken>, _project_id: u64, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.project.active_boxes_count == 0,
        MysteryBoxError::ProjectHasActiveBoxes
    );

    require_keys_eq!(ctx.accounts.vault_token_account.mint, ctx.accounts.token_mint.key(), MysteryBoxError::InvalidMint);
    require_keys_eq!(ctx.accounts.vault_token_account.owner, ctx.accounts.vault.key(), MysteryBoxError::Unauthorized);
    require_keys_eq!(ctx.accounts.authority_token_account.mint, ctx.accounts.token_mint.key(), MysteryBoxError::InvalidMint);
    require_keys_eq!(ctx.accounts.authority_token_account.owner, ctx.accounts.authority.key(), MysteryBoxError::Unauthorized);

    let project_key = ctx.accounts.project.key();
    let seeds = &[
        VAULT_SEED,
        project_key.as_ref(),
        &[ctx.accounts.vault.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
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

#[derive(Accounts)]
#[instruction(project_id: u64)]
pub struct CloseVaultTokenAccount<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Account<'info, PlatformConfig>,
    #[account(
        seeds = [PROJECT_SEED, &project_id.to_le_bytes()],
        bump = project.bump
    )]
    pub project: Account<'info, Project>,
    #[account(
        seeds = [VAULT_SEED, project.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, PrizeVault>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    /// CHECK: verified against platform config
    #[account(mut, address = platform.treasury)]
    pub platform_treasury: UncheckedAccount<'info>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn close_vault_token_account(ctx: Context<CloseVaultTokenAccount>, _project_id: u64) -> Result<()> {
    let project = &ctx.accounts.project;
    let vault = &ctx.accounts.vault;
    let vault_token_account = &ctx.accounts.vault_token_account;

    require_keys_eq!(vault_token_account.owner, vault.key(), MysteryBoxError::Unauthorized);
    require!(vault_token_account.amount == 0, MysteryBoxError::InsufficientFunds);

    let project_key = project.key();
    let seeds = &[
        VAULT_SEED,
        project_key.as_ref(),
        &[vault.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: vault_token_account.to_account_info(),
            destination: ctx.accounts.platform_treasury.to_account_info(),
            authority: vault.to_account_info(),
        },
        signer,
    );
    token::close_account(cpi_ctx)?;

    Ok(())
}
