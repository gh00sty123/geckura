use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::SysvarId;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

extern "C" {
    fn sol_sha256(vals: *const u8, val_len: u64, hash_result: *mut u8) -> u64;
}

use crate::errors::MysteryBoxError;
use crate::state::{
    BoxConfig, BoxOpenEvent, BoxReceipt, BoxStatus, PlatformConfig, PrizeType,
    PrizeVault, Project, BOX_SEED, MAX_BOXES_PER_TX, PLATFORM_SEED, PROJECT_SEED,
    RECEIPT_SEED, VAULT_SEED,
};





#[derive(Accounts)]
#[instruction(slug: String, box_id: u64, quantity: u8)]
pub struct OpenBox<'info> {
    #[account(
        seeds = [PLATFORM_SEED],
        bump = platform.bump
    )]
    pub platform: Box<Account<'info, PlatformConfig>>,
    #[account(
        seeds = [PROJECT_SEED, slug.as_bytes()],
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
        init_if_needed,
        payer = user,
        space = BoxReceipt::SPACE,
        seeds = [RECEIPT_SEED, user.key().as_ref(), box_config.key().as_ref()],
        bump
    )]
    pub receipt: Box<Account<'info, BoxReceipt>>,
    #[account(
        mut,
        seeds = [VAULT_SEED, project.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Box<Account<'info, PrizeVault>>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: fee wallet receives SOL only
    #[account(mut, address = project.fee_wallet)]
    pub fee_wallet: UncheckedAccount<'info>,
    /// CHECK: second fee wallet receives SOL only
    #[account(mut, address = project.fee_wallet_2)]
    pub fee_wallet_2: UncheckedAccount<'info>,
    /// CHECK: tenant wallet receives SOL only
    #[account(mut, address = project.authority)]
    pub tenant_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: SlotHashes sysvar for fetching the latest slot hash
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

pub fn open_box<'info>(
    ctx: Context<'info, OpenBox<'info>>,
    _slug: String,
    _box_id: u64,
    quantity: u8,
) -> Result<()> {
    let platform = &ctx.accounts.platform;
    let project = &ctx.accounts.project;
    let box_config = &mut ctx.accounts.box_config;
    let receipt = &mut ctx.accounts.receipt;
    let user = &ctx.accounts.user;
    let vault = &*ctx.accounts.vault;

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

    // 1. Payment
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
        let fee_1 = total_fee.checked_div(2).ok_or(MysteryBoxError::MathOverflow)?;
        let fee_2 = total_fee.checked_sub(fee_1).ok_or(MysteryBoxError::MathOverflow)?;

        if fee_1 > 0 {
            let cpi_fee1 = CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: user.to_account_info(),
                    to: ctx.accounts.fee_wallet.to_account_info(),
                },
            );
            system_program::transfer(cpi_fee1, fee_1)?;
        }

        if fee_2 > 0 {
            let cpi_fee2 = CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: user.to_account_info(),
                    to: ctx.accounts.fee_wallet_2.to_account_info(),
                },
            );
            system_program::transfer(cpi_fee2, fee_2)?;
        }
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

    if box_config.sold >= box_config.supply {
        box_config.status = BoxStatus::Ended;
    }

    // 2. Fetch the latest slot hash from the slot_hashes sysvar
    let slot_hashes_data = ctx.accounts.slot_hashes.try_borrow_data()?;
    if slot_hashes_data.len() < 48 {
        return Err(error!(MysteryBoxError::SlotHashNotFound));
    }
    let mut latest_hash = [0u8; 32];
    latest_hash.copy_from_slice(&slot_hashes_data[16..48]);

    let mut total_sol_won: u64 = 0;

    // 3. Roll and distribute rewards for each box
    for _ in 0..quantity {
        receipt.nonce = receipt.nonce.wrapping_add(1);

        let mut hash_input = [0u8; 112];
        hash_input[0..32].copy_from_slice(user.key().as_ref());
        hash_input[32..64].copy_from_slice(&latest_hash);
        hash_input[64..96].copy_from_slice(box_config.key().as_ref());
        hash_input[96..104].copy_from_slice(&receipt.nonce.to_le_bytes());
        hash_input[104..112].copy_from_slice(&clock.slot.to_le_bytes());

        let mut hash_result = [0u8; 32];
        let slices = [&hash_input[..]];
        unsafe {
            sol_sha256(
                slices.as_ptr() as *const u8,
                slices.len() as u64,
                hash_result.as_mut_ptr(),
            );
        }
        let random_u64 = u64::from_le_bytes(hash_result[0..8].try_into().unwrap());

        let mut is_winner = false;
        let mut total_weight = 0u64;
        let mut guaranteed_prize_index: Option<usize> = None;

        let remaining_accounts = ctx.remaining_accounts;
        let prizes_count = box_config.prizes_count as usize;
        require!(remaining_accounts.len() >= prizes_count, MysteryBoxError::Unauthorized);

        let mut valid_prize_indices = [0u8; 32];
        let mut valid_prize_weights = [0u8; 32];
        let mut valid_count = 0;

        for i in 0..prizes_count {
            let account_info = &remaining_accounts[i];
            let prize_item = crate::state::PrizeItem::try_deserialize(&mut &**account_info.try_borrow_data()?)?;
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
            require!(prize_item.index as usize == i, MysteryBoxError::Unauthorized);

            let idx = prize_item.index as usize;
            if idx < 20 {
                let claimed = box_config.claimed_prizes[idx];
                let rem = prize_item.total_count.saturating_sub(claimed);
                if rem > 0 {
                    total_weight = total_weight.saturating_add(prize_item.win_percentage as u64);
                    if prize_item.win_percentage == 100 {
                        guaranteed_prize_index = Some(i);
                    }
                    if valid_count < 32 {
                        valid_prize_indices[valid_count] = i as u8;
                        valid_prize_weights[valid_count] = prize_item.win_percentage;
                        valid_count += 1;
                    }
                }
            }
        }

        let mut amount_won: u64 = 0;
        let mut prize_type = PrizeType::Sol;
        let mut token_mint = Pubkey::default();
        let mut prize_index: u8 = 0;
        let mut winning_account_index: Option<usize> = None;

        if let Some(i) = guaranteed_prize_index {
            is_winner = true;
            winning_account_index = Some(i);
        } else if total_weight > 0 {
            let prize_roll = random_u64 % total_weight;
            let mut cumulative = 0u64;

            for k in 0..valid_count {
                cumulative = cumulative.saturating_add(valid_prize_weights[k] as u64);
                if prize_roll < cumulative {
                    is_winner = true;
                    winning_account_index = Some(valid_prize_indices[k] as usize);
                    break;
                }
            }
        }

        if is_winner && winning_account_index.is_some() {
            let winning_acc_info = &remaining_accounts[winning_account_index.unwrap()];
            let prize = crate::state::PrizeItem::try_deserialize(&mut &**winning_acc_info.try_borrow_data()?)?;
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
                    let current_total_sol_won = total_sol_won
                        .checked_add(amount_won)
                        .ok_or(MysteryBoxError::MathOverflow)?;
                    require!(vault_lamports >= current_total_sol_won, MysteryBoxError::InsufficientFunds);
                    total_sol_won = current_total_sol_won;
                }
                PrizeType::SplToken | PrizeType::Nft => {
                    let mut vault_token_info = None;
                    let mut user_token_info = None;

                    // 1. Try to use named accounts if they match the won prize mint
                    if let (Some(v), Some(u)) = (&ctx.accounts.vault_token_account, &ctx.accounts.user_token_account) {
                        if v.mint == prize.token_mint && u.mint == prize.token_mint {
                            vault_token_info = Some(v.to_account_info());
                            user_token_info = Some(u.to_account_info());
                        }
                    }

                    // 2. If they didn't match or weren't provided, look up in remaining accounts using cheap helper
                    if vault_token_info.is_none() || user_token_info.is_none() {
                        for acc in ctx.remaining_accounts.iter() {
                            if validate_token_account(acc, &prize.token_mint, &vault.key()) {
                                vault_token_info = Some(acc.clone());
                            } else if validate_token_account(acc, &prize.token_mint, &user.key()) {
                                user_token_info = Some(acc.clone());
                            }
                        }
                    }

                    require!(
                        vault_token_info.is_some() && user_token_info.is_some() && ctx.accounts.token_program.is_some(),
                        MysteryBoxError::InsufficientFunds
                    );

                    let vault_token_acc_info = vault_token_info.unwrap();
                    let user_token_acc_info = user_token_info.unwrap();
                    let token_program = ctx.accounts.token_program.as_ref().unwrap();

                    // Perform security checks on vault/user token accounts
                    {
                        let vault_token_data = vault_token_acc_info.try_borrow_data()?;
                        let user_token_data = user_token_acc_info.try_borrow_data()?;
                        require!(vault_token_data.len() >= 64, MysteryBoxError::InsufficientFunds);
                        require!(user_token_data.len() >= 64, MysteryBoxError::InsufficientFunds);

                        // Check amount won constraint (amount: u64 is at bytes 64..72)
                        let mut amount_bytes = [0u8; 8];
                        amount_bytes.copy_from_slice(&vault_token_data[64..72]);
                        let vault_amount = u64::from_le_bytes(amount_bytes);
                        require!(vault_amount >= amount_won, MysteryBoxError::InsufficientFunds);
                    }

                    let cpi_ctx = CpiContext::new(
                        token_program.key(),
                        Transfer {
                            from: vault_token_acc_info,
                            to: user_token_acc_info,
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
        receipt.total_opened = receipt.total_opened
            .checked_add(1)
            .ok_or(MysteryBoxError::MathOverflow)?;

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
    }

    if total_sol_won > 0 {
        let vault_lamports = vault.to_account_info().lamports();
        **vault.to_account_info().try_borrow_mut_lamports()? = vault_lamports
            .checked_sub(total_sol_won)
            .ok_or(MysteryBoxError::MathOverflow)?;

        **user.to_account_info().try_borrow_mut_lamports()? = user.to_account_info().lamports()
            .checked_add(total_sol_won)
            .ok_or(MysteryBoxError::MathOverflow)?;
    }

    Ok(())
}

fn validate_token_account(
    acc: &AccountInfo,
    expected_mint: &Pubkey,
    expected_owner: &Pubkey,
) -> bool {
    if acc.owner != &anchor_spl::token::ID {
        return false;
    }
    let data = match acc.try_borrow_data() {
        Ok(d) => d,
        Err(_) => return false,
    };
    if data.len() < 64 {
        return false;
    }
    &data[0..32] == expected_mint.as_ref() && &data[32..64] == expected_owner.as_ref()
}
