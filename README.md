# Week 10 — CPI and Vault Withdrawals

For Week 10, I added a withdrawal instruction to the Liquidity Vault. The user selects how many share tokens to redeem. The program calculates the proportional asset amount, burns those shares through the SPL Token Program, and transfers the assets from the vault token account to the user's account. The vault config PDA signs the transfer CPI.

The instruction checks that the user owns the position and shares, the vault is not paused, and the calculated withdrawal meets the user's minimum. Arithmetic uses checked operations.

## Verification

`cargo check` and formatting checks pass. SBF deployment verification still needs a clean build because the local toolchain reported unknown-syscall warnings.
