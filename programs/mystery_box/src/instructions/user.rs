use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::SysvarId;
use solana_instructions_sysvar::{
    ID as INSTRUCTIONS_ID,
    load_current_index_checked,
    load_instruction_at_checked,
};
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, Transfer};

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
    /// CHECK: initialized manually in handler if empty
    #[account(
        mut,
        seeds = [RECEIPT_SEED, user.key().as_ref(), project.key().as_ref()],
        bump
    )]
    pub receipt: UncheckedAccount<'info>,
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
    /// CHECK: tenant wallet receives SOL only
    #[account(mut, address = project.authority)]
    pub tenant_wallet: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: SlotHashes sysvar for fetching the latest slot hash
    #[account(address = SlotHashes::id())]
    pub slot_hashes: UncheckedAccount<'info>,
    /// CHECK: Instructions sysvar for CPI Guard
    #[account(address = INSTRUCTIONS_ID)]
    pub instructions: UncheckedAccount<'info>,
}

pub fn open_box<'info>(
    ctx: Context<'info, OpenBox<'info>>,
    _slug: String,
    _box_id: u64,
    quantity: u8,
) -> Result<()> {
    // CPI Guard: Verify instruction is top-level to prevent contract rollback attacks
    let instructions_sysvar = &ctx.accounts.instructions.to_account_info();
    let current_index = load_current_index_checked(instructions_sysvar)? as usize;
    let current_ix = load_instruction_at_checked(current_index, instructions_sysvar)?;
    require_keys_eq!(
        current_ix.program_id,
        *ctx.program_id,
        MysteryBoxError::Unauthorized
    );

    let platform = &ctx.accounts.platform;
    let project = &ctx.accounts.project;
    let box_config = &mut ctx.accounts.box_config;
    let user = &ctx.accounts.user;
    let receipt_info = &ctx.accounts.receipt;

    let mut receipt: BoxReceipt = if receipt_info.data_is_empty() {
        let rent = Rent::get()?;
        let space = BoxReceipt::SPACE;
        let lamports = rent.minimum_balance(space);

        let user_key = user.key();
        let project_key = project.key();
        let receipt_bump = [ctx.bumps.receipt];
        let signer_seeds = &[
            RECEIPT_SEED,
            user_key.as_ref(),
            project_key.as_ref(),
            &receipt_bump,
        ];

        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::create_account(
                user.key,
                receipt_info.key,
                lamports,
                space as u64,
                ctx.program_id,
            ),
            &[
                user.to_account_info(),
                receipt_info.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[signer_seeds],
        )?;

        BoxReceipt {
            user: user.key(),
            project: project.key(),
            purchased: 0,
            total_opened: 0,
            nonce: 0,
            claimable_prizes: Vec::new(),
            bump: ctx.bumps.receipt,
        }
    } else {
        require_keys_eq!(*receipt_info.owner, *ctx.program_id, MysteryBoxError::Unauthorized);

        let data: &[u8] = &receipt_info.try_borrow_data()?;
        let disc = BoxReceipt::DISCRIMINATOR;
        require!(data.len() >= 8 && &data[..8] == disc, MysteryBoxError::Unauthorized);

        let mut reader = &data[8..];
        AnchorDeserialize::deserialize(&mut reader)?
    };

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

    let fee_quantity = if receipt.total_opened == 0 {
        if quantity > 1 {
            (quantity - 1) as u64
        } else {
            0u64
        }
    } else {
        quantity as u64
    };

    let total_fee = project
        .fee_lamports
        .checked_mul(fee_quantity)
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

        let prizes_count = box_config.prizes.len();

        let mut valid_prize_indices = [0u8; 32];
        let mut valid_prize_weights = [0u8; 32];
        let mut valid_count = 0;

        for i in 0..prizes_count {
            let prize_item = &box_config.prizes[i];
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
            let prize = box_config.prizes[winning_account_index.unwrap()];
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

            // Add won prize to the claimable list
            require!(
                receipt.claimable_prizes.len() < crate::state::BoxReceipt::MAX_CLAIMABLE_PRIZES,
                MysteryBoxError::Unauthorized
            );
            receipt.claimable_prizes.push(crate::state::ClaimablePrize {
                box_config: box_config.key(),
                prize_index: prize.index,
                prize_type: prize.prize_type,
                token_mint: prize.token_mint,
                amount: amount_won,
            });
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

    // Serialize state back to account data
    let mut data = ctx.accounts.receipt.try_borrow_mut_data()?;
    let writer = &mut data[..];
    writer[..8].copy_from_slice(&BoxReceipt::DISCRIMINATOR);
    let mut payload = &mut writer[8..];
    receipt.serialize(&mut payload)?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(slug: String)]
pub struct ClaimPrizes<'info> {
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
        seeds = [RECEIPT_SEED, user.key().as_ref(), project.key().as_ref()],
        bump = receipt.bump
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
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn claim_prizes<'info>(
    ctx: Context<'info, ClaimPrizes<'info>>,
    _slug: String,
) -> Result<()> {
    let project = &ctx.accounts.project;
    let receipt = &mut ctx.accounts.receipt;
    let vault = &ctx.accounts.vault;
    let user = &ctx.accounts.user;

    let mut total_sol_won: u64 = 0;

    for prize in receipt.claimable_prizes.iter() {
        let amount_won = prize.amount;
        if amount_won == 0 {
            continue;
        }

        match prize.prize_type {
            PrizeType::Sol => {
                total_sol_won = total_sol_won
                    .checked_add(amount_won)
                    .ok_or(MysteryBoxError::MathOverflow)?;
            }
            PrizeType::SplToken | PrizeType::Nft => {
                let mut vault_token_info = None;
                let mut user_token_info = None;

                for acc in ctx.remaining_accounts.iter() {
                    if validate_token_account(acc, &prize.token_mint, &vault.key()) {
                        vault_token_info = Some(acc.clone());
                    } else if validate_token_account(acc, &prize.token_mint, &user.key()) {
                        user_token_info = Some(acc.clone());
                    }
                }

                require!(
                    vault_token_info.is_some() && user_token_info.is_some(),
                    MysteryBoxError::InsufficientFunds
                );

                let vault_token_acc_info = vault_token_info.unwrap();
                let user_token_acc_info = user_token_info.unwrap();

                {
                    let vault_token_data = vault_token_acc_info.try_borrow_data()?;
                    let user_token_data = user_token_acc_info.try_borrow_data()?;
                    require!(vault_token_data.len() >= 64, MysteryBoxError::InsufficientFunds);
                    require!(user_token_data.len() >= 64, MysteryBoxError::InsufficientFunds);

                    let mut amount_bytes = [0u8; 8];
                    amount_bytes.copy_from_slice(&vault_token_data[64..72]);
                    let vault_amount = u64::from_le_bytes(amount_bytes);
                    require!(vault_amount >= amount_won, MysteryBoxError::InsufficientFunds);
                }

                let cpi_ctx = CpiContext::new(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: vault_token_acc_info,
                        to: user_token_acc_info,
                        authority: vault.to_account_info(),
                    },
                );

                let project_key = project.key();
                let seeds = &[
                    VAULT_SEED,
                    project_key.as_ref(),
                    &[vault.bump],
                ];
                let signer = &[&seeds[..]];

                token::transfer(cpi_ctx.with_signer(signer), amount_won)?;
            }
        }
    }

    if total_sol_won > 0 {
        let vault_lamports = vault.to_account_info().lamports();
        require!(vault_lamports >= total_sol_won, MysteryBoxError::InsufficientFunds);

        **vault.to_account_info().try_borrow_mut_lamports()? = vault_lamports
            .checked_sub(total_sol_won)
            .ok_or(MysteryBoxError::MathOverflow)?;

        **user.to_account_info().try_borrow_mut_lamports()? = user.to_account_info().lamports()
            .checked_add(total_sol_won)
            .ok_or(MysteryBoxError::MathOverflow)?;
    }

    receipt.claimable_prizes.clear();

    Ok(())
}

#[derive(Accounts)]
#[instruction(slug: String)]
pub struct CloseReceipt<'info> {
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
        seeds = [RECEIPT_SEED, user.key().as_ref(), project.key().as_ref()],
        bump = receipt.bump,
        close = platform_treasury
    )]
    pub receipt: Account<'info, BoxReceipt>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: platform treasury receives the closed account rent
    #[account(
        mut,
        address = platform.treasury
    )]
    pub platform_treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn close_receipt(ctx: Context<CloseReceipt>, _slug: String) -> Result<()> {
    let receipt = &ctx.accounts.receipt;
    require!(receipt.claimable_prizes.is_empty(), MysteryBoxError::PendingPrizesExist);
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
