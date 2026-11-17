use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::memo::Memo;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use anchor_spl::token_2022::Token2022;

declare_id!("5Mt5EcuiqoizEPsFC6Rqz7ZwoVTAdMzbvHLiDB4DxoNH");

pub const CONFIG_SEED: &[u8] = b"config";
pub const SHARE_MINT_SEED: &[u8] = b"share-mint";
pub const USER_POSITION_SEED: &[u8] = b"user";
pub const RAYDIUM_CLMM_PROGRAM_ID: Pubkey = pubkey!("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");

#[program]
pub mod liquidity_vault {
    use super::*;

    /// Creates the vault configuration, share-token mint, and vault asset ATA.
    pub fn initialize_vault(ctx: Context<InitializeVault>, share_decimals: u8) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.asset_mint = ctx.accounts.asset_mint.key();
        config.share_mint = ctx.accounts.share_mint.key();
        config.vault_token_account = ctx.accounts.vault_token_account.key();
        config.paused = false;
        config.bump = ctx.bumps.config;
        config.share_mint_bump = ctx.bumps.share_mint;

        msg!("Liquidity vault initialized: {}", config.key());
        msg!("Share mint decimals: {}", share_decimals);
        Ok(())
    }

    /// Creates a per-user PDA and the user's associated share-token account.
    pub fn initialize_user(ctx: Context<InitializeUser>) -> Result<()> {
        let position = &mut ctx.accounts.user_position;
        position.owner = ctx.accounts.owner.key();
        position.config = ctx.accounts.config.key();
        position.shares = 0;
        position.bump = ctx.bumps.user_position;

        msg!("User position initialized: {}", position.key());
        Ok(())
    }

    /// Deposits the vault's asset and mints the matching share tokens to the user.
    pub fn deposit(ctx: Context<Deposit>, amount: u64, min_shares_out: u64) -> Result<()> {
        require!(amount > 0, VaultError::AmountZero);
        require!(!ctx.accounts.config.paused, VaultError::VaultPaused);

        let assets_before = ctx.accounts.vault_token_account.amount;
        let shares_before = ctx.accounts.share_mint.supply;
        let shares_out = if shares_before == 0 {
            require!(assets_before == 0, VaultError::InvalidVaultState);
            let share_scale = 10u128
                .checked_pow(ctx.accounts.share_mint.decimals.into())
                .ok_or(VaultError::MathOverflow)?;
            let asset_scale = 10u128
                .checked_pow(ctx.accounts.asset_mint.decimals.into())
                .ok_or(VaultError::MathOverflow)?;
            (amount as u128)
                .checked_mul(share_scale)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(asset_scale)
                .ok_or(VaultError::MathOverflow)?
        } else {
            require!(assets_before > 0, VaultError::InvalidVaultState);
            (amount as u128)
                .checked_mul(shares_before as u128)
                .ok_or(VaultError::MathOverflow)?
                .checked_div(assets_before as u128)
                .ok_or(VaultError::MathOverflow)?
        };

        let shares_out = u64::try_from(shares_out).map_err(|_| VaultError::MathOverflow)?;
        require!(shares_out > 0, VaultError::DepositTooSmall);
        require!(shares_out >= min_shares_out, VaultError::SlippageExceeded);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_asset_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let config_bump = [ctx.accounts.config.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &config_bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_share_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer_seeds,
            ),
            shares_out,
        )?;

        let position = &mut ctx.accounts.user_position;
        position.shares = position
            .shares
            .checked_add(shares_out)
            .ok_or(VaultError::MathOverflow)?;

        msg!(
            "Deposit: {} asset units for {} share units",
            amount,
            shares_out
        );
        Ok(())
    }

    /// Burns the user's shares and transfers the proportional asset amount from the vault.
    pub fn withdraw(
        ctx: Context<Withdraw>,
        shares_to_burn: u64,
        min_assets_out: u64,
    ) -> Result<()> {
        require!(shares_to_burn > 0, VaultError::SharesAmountZero);
        require!(!ctx.accounts.config.paused, VaultError::VaultPaused);
        require!(
            shares_to_burn <= ctx.accounts.user_position.shares,
            VaultError::InsufficientPositionShares
        );

        let assets_before = ctx.accounts.vault_token_account.amount;
        let shares_before = ctx.accounts.share_mint.supply;
        require!(
            assets_before > 0 && shares_before > 0,
            VaultError::InvalidVaultState
        );

        let assets_out = (shares_to_burn as u128)
            .checked_mul(assets_before as u128)
            .ok_or(VaultError::MathOverflow)?
            .checked_div(shares_before as u128)
            .ok_or(VaultError::MathOverflow)?;
        let assets_out = u64::try_from(assets_out).map_err(|_| VaultError::MathOverflow)?;

        require!(assets_out > 0, VaultError::WithdrawTooSmall);
        require!(assets_out >= min_assets_out, VaultError::SlippageExceeded);

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    from: ctx.accounts.user_share_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            shares_to_burn,
        )?;

        let config_bump = [ctx.accounts.config.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &config_bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.user_asset_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer_seeds,
            ),
            assets_out,
        )?;

        let position = &mut ctx.accounts.user_position;
        position.shares = position
            .shares
            .checked_sub(shares_to_burn)
            .ok_or(VaultError::MathOverflow)?;

        msg!(
            "Withdraw: burned {} share units for {} asset units",
            shares_to_burn,
            assets_out
        );
        Ok(())
    }

    pub fn swap_via_clmm<'info>(
        ctx: Context<'_, '_, '_, 'info, SwapViaClmm<'info>>,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        require!(amount_in > 0, VaultError::AmountZero);
        require!(min_amount_out > 0, VaultError::SlippageExceeded);
        require!(!ctx.accounts.config.paused, VaultError::VaultPaused);
        require!(
            ctx.accounts.input_mint.key() != ctx.accounts.output_mint.key(),
            VaultError::SameSwapMint
        );
        require!(
            ctx.accounts.vault_input.amount >= amount_in,
            VaultError::InsufficientVaultBalance
        );

        let input_before = ctx.accounts.vault_input.amount;
        let output_before = ctx.accounts.vault_output.amount;
        let mut data = vec![43, 4, 237, 11, 26, 201, 30, 98];
        data.extend_from_slice(&amount_in.to_le_bytes());
        data.extend_from_slice(&min_amount_out.to_le_bytes());
        data.extend_from_slice(&0u128.to_le_bytes());
        data.push(1);

        let mut metas = vec![
            AccountMeta::new_readonly(ctx.accounts.config.key(), true),
            AccountMeta::new_readonly(ctx.accounts.amm_config.key(), false),
            AccountMeta::new(ctx.accounts.pool_state.key(), false),
            AccountMeta::new(ctx.accounts.vault_input.key(), false),
            AccountMeta::new(ctx.accounts.vault_output.key(), false),
            AccountMeta::new(ctx.accounts.pool_input_vault.key(), false),
            AccountMeta::new(ctx.accounts.pool_output_vault.key(), false),
            AccountMeta::new(ctx.accounts.observation_state.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.token_program_2022.key(), false),
            AccountMeta::new_readonly(ctx.accounts.memo_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.input_mint.key(), false),
            AccountMeta::new_readonly(ctx.accounts.output_mint.key(), false),
        ];
        let mut account_infos = vec![
            ctx.accounts.config.to_account_info(),
            ctx.accounts.amm_config.to_account_info(),
            ctx.accounts.pool_state.to_account_info(),
            ctx.accounts.vault_input.to_account_info(),
            ctx.accounts.vault_output.to_account_info(),
            ctx.accounts.pool_input_vault.to_account_info(),
            ctx.accounts.pool_output_vault.to_account_info(),
            ctx.accounts.observation_state.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.token_program_2022.to_account_info(),
            ctx.accounts.memo_program.to_account_info(),
            ctx.accounts.input_mint.to_account_info(),
            ctx.accounts.output_mint.to_account_info(),
        ];

        for account in ctx.remaining_accounts {
            metas.push(if account.is_writable {
                AccountMeta::new(*account.key, account.is_signer)
            } else {
                AccountMeta::new_readonly(*account.key, account.is_signer)
            });
            account_infos.push(account.clone());
        }

        let instruction = Instruction {
            program_id: RAYDIUM_CLMM_PROGRAM_ID,
            accounts: metas,
            data,
        };
        account_infos.push(ctx.accounts.raydium_program.to_account_info());
        let bump = [ctx.accounts.config.bump];
        let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];
        invoke_signed(&instruction, &account_infos, signer_seeds)?;

        ctx.accounts.vault_input.reload()?;
        ctx.accounts.vault_output.reload()?;
        let spent = input_before
            .checked_sub(ctx.accounts.vault_input.amount)
            .ok_or(VaultError::MathOverflow)?;
        let received = ctx
            .accounts
            .vault_output
            .amount
            .checked_sub(output_before)
            .ok_or(VaultError::MathOverflow)?;
        require!(spent == amount_in, VaultError::UnexpectedSwapInput);
        require!(received >= min_amount_out, VaultError::SlippageExceeded);
        msg!("Vault CLMM swap: spent {}, received {}", spent, received);
        Ok(())
    }

    /// Allows the configured administrator to pause or resume future vault actions.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        msg!("Vault paused: {}", paused);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(share_decimals: u8)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, VaultConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub asset_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [SHARE_MINT_SEED],
        bump,
        mint::decimals = share_decimals,
        mint::authority = config,
        mint::freeze_authority = config
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = asset_mint,
        associated_token::authority = config
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializeUser<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, VaultConfig>,

    #[account(
        seeds = [SHARE_MINT_SEED],
        bump = config.share_mint_bump,
        address = config.share_mint
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [USER_POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = share_mint,
        associated_token::authority = owner
    )]
    pub share_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ VaultError::VaultPaused
    )]
    pub config: Account<'info, VaultConfig>,

    #[account(address = config.asset_mint)]
    pub asset_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = config.vault_token_account,
        token::mint = asset_mint,
        token::authority = config
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SHARE_MINT_SEED],
        bump = config.share_mint_bump,
        address = config.share_mint,
        mint::authority = config
    )]
    pub share_mint: Account<'info, Mint>,

    pub owner: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = owner
    )]
    pub user_asset_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [USER_POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump = user_position.bump,
        has_one = owner,
        has_one = config
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(
        mut,
        associated_token::mint = share_mint,
        associated_token::authority = owner
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ VaultError::VaultPaused
    )]
    pub config: Account<'info, VaultConfig>,

    #[account(address = config.asset_mint)]
    pub asset_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = config.vault_token_account,
        token::mint = asset_mint,
        token::authority = config
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [SHARE_MINT_SEED],
        bump = config.share_mint_bump,
        address = config.share_mint,
        mint::authority = config
    )]
    pub share_mint: Account<'info, Mint>,

    pub owner: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = share_mint,
        associated_token::authority = owner
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = owner
    )]
    pub user_asset_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [USER_POSITION_SEED, config.key().as_ref(), owner.key().as_ref()],
        bump = user_position.bump,
        has_one = owner,
        has_one = config
    )]
    pub user_position: Account<'info, UserPosition>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SwapViaClmm<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, VaultConfig>,

    pub admin: Signer<'info>,

    #[account(address = config.asset_mint)]
    pub input_mint: Account<'info, Mint>,

    pub output_mint: Account<'info, Mint>,

    #[account(
        mut,
        address = config.vault_token_account,
        token::mint = input_mint,
        token::authority = config
    )]
    pub vault_input: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = output_mint,
        token::authority = config
    )]
    pub vault_output: Account<'info, TokenAccount>,

    pub amm_config: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool_state: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool_input_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool_output_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    pub token_program_2022: Program<'info, Token2022>,

    pub memo_program: Program<'info, Memo>,

    #[account(address = RAYDIUM_CLMM_PROGRAM_ID)]
    pub raydium_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin
    )]
    pub config: Account<'info, VaultConfig>,

    pub admin: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub admin: Pubkey,
    pub asset_mint: Pubkey,
    pub share_mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub paused: bool,
    pub bump: u8,
    pub share_mint_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub owner: Pubkey,
    pub config: Pubkey,
    pub shares: u64,
    pub bump: u8,
}

#[error_code]
pub enum VaultError {
    #[msg("Deposit amount must be greater than zero")]
    AmountZero,
    #[msg("The vault is paused")]
    VaultPaused,
    #[msg("Vault assets and share supply are inconsistent")]
    InvalidVaultState,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Deposit is too small to mint one share unit")]
    DepositTooSmall,
    #[msg("Shares to burn must be greater than zero")]
    SharesAmountZero,
    #[msg("User position does not contain enough shares")]
    InsufficientPositionShares,
    #[msg("Withdrawal is too small to return one asset unit")]
    WithdrawTooSmall,
    #[msg("Calculated amount is below the user's minimum")]
    SlippageExceeded,
    #[msg("Input and output token mints must be different")]
    SameSwapMint,
    #[msg("Vault does not have enough input tokens")]
    InsufficientVaultBalance,
    #[msg("Swap did not use the requested input amount")]
    UnexpectedSwapInput,
}
