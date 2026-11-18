# Week 13 — Raydium CLMM Position

This week I made the vault open a Raydium position from its PDA. It use a selected price range. The script move price out of this range, removes liquidity to get fees, closes old position and opens a new one. I learned the vault PDA need to sign for position and fees are collected when liquidity is decreased.
