# Week 11 — Raydium CLMM

I added a script that creates two test tokens on Solana devnet, makes a Raydium CLMM pool at a 1:1 starting price, and opens a position from 0.9 to 1.1. I used the Raydium SDK and SPL Token Program.

The first compile had a few TypeScript type errors, which I fixed. The script compiles now. I could not finish the devnet transactions from this environment because its RPC request failed, so the pool and position addresses will appear in `week-11-devnet-results.json` after a successful run.

## Run

1. Make sure your Solana wallet is set to devnet and has enough devnet SOL for account creation and transactions.
2. Keep `HELIUS_API_KEY` in the ignored `.env` file, or set `SOLANA_RPC_URL` to a devnet RPC endpoint.
3. Install dependencies with `npm install`.
4. Run `npm run week11:create`.
5. Save the mint addresses, pool address and transaction signatures from `week-11-devnet-results.json`.
