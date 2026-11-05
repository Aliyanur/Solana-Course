use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

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
