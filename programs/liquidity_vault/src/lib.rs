use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("5Mt5EcuiqoizEPsFC6Rqz7ZwoVTAdMzbvHLiDB4DxoNH");

pub const CONFIG_SEED: &[u8] = b"config";
pub const SHARE_MINT_SEED: &[u8] = b"share-mint";
pub const USER_POSITION_SEED: &[u8] = b"user";

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
    #[msg("Calculated shares are below the user's minimum")]
    SlippageExceeded,
}
