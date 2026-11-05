# Week 8 — Liquidity Vault

For Week 8, I started the Anchor framework for my liquidity vault. It can create the vault settings PDA, a share-token mint, a vault token account, and a user position PDA with a share-token account. I also added an admin instruction to pause or resume the vault.

## What I learned

My local Solana CLI was initially 1.18.26, while Anchor 0.31.1 recommends Solana 2.1.0. This caused toolchain problems, so I pinned the project versions in `Anchor.toml`. `cargo check` passed. The SBF build still showed unknown syscall warnings, so I have not treated it as ready to deploy.

The vault does not handle deposits or connect to a liquidity pool yet. Those are the next steps.
