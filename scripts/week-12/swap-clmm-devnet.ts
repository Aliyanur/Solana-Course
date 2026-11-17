import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { getAccount, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js'
import { DEVNET_PROGRAM_ID, MEMO_PROGRAM_ID, Raydium } from '@raydium-io/raydium-sdk-v2'

const programId = new PublicKey('5Mt5EcuiqoizEPsFC6Rqz7ZwoVTAdMzbvHLiDB4DxoNH')
const rpcUrl = process.env.SOLANA_RPC_URL ?? (process.env.HELIUS_API_KEY ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : clusterApiUrl('devnet'))
const keypairPath = process.env.SOLANA_KEYPAIR ?? resolve(homedir(), '.config/solana/id.json')
const resultsPath = process.env.WEEK11_RESULTS ?? 'week-11-devnet-results.json'
const outputPath = 'week-12-devnet-results.json'
const amountInUi = process.env.SWAP_AMOUNT ?? '0.1'
const depositUi = process.env.VAULT_DEPOSIT_AMOUNT ?? '1'
const slippageBps = Number(process.env.SWAP_SLIPPAGE_BPS ?? '500')

if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10000) {
  throw new Error('SWAP_SLIPPAGE_BPS must be an integer between 0 and 9999.')
}

const [secretKey, saved] = await Promise.all([
  readFile(keypairPath, 'utf8').then((value) => Uint8Array.from(JSON.parse(value) as number[])),
  readFile(resultsPath, 'utf8').then((value) => JSON.parse(value) as {
    network: string
    owner: string
    tokens: { symbol: string; mint: string; decimals: number }[]
    pool: string | null
  })
])

if (saved.network !== 'devnet' || !saved.pool) throw new Error('Week 11 devnet pool results are missing.')

const owner = Keypair.fromSecretKey(secretKey)
if (owner.publicKey.toBase58() !== saved.owner) throw new Error('The configured wallet is not the wallet used for the Week 11 pool.')

const input = saved.tokens.find((token) => token.symbol === 'STUDENT_A')
const output = saved.tokens.find((token) => token.symbol === 'STUDENT_B')
if (!input || !output || input.decimals !== output.decimals) throw new Error('Expected matching STUDENT_A and STUDENT_B mints in the Week 11 results.')

const amountInUiNumber = Number(amountInUi)
const depositUiNumber = Number(depositUi)
const scale = 10 ** input.decimals
if (!Number.isFinite(amountInUiNumber) || amountInUiNumber <= 0 || !Number.isSafeInteger(amountInUiNumber * scale)) {
  throw new Error('SWAP_AMOUNT must be a positive amount with supported token precision.')
}
if (!Number.isFinite(depositUiNumber) || depositUiNumber < amountInUiNumber || !Number.isSafeInteger(depositUiNumber * scale)) {
  throw new Error('VAULT_DEPOSIT_AMOUNT must be at least SWAP_AMOUNT and use supported token precision.')
}

const amountIn = Math.round(amountInUiNumber * scale)
const depositAmount = Math.round(depositUiNumber * scale)
const minAmountOut = Math.floor(amountIn * (10000 - slippageBps) / 10000)
const connection = new Connection(rpcUrl, 'confirmed')
const raydium = await Raydium.load({
  owner,
  connection,
  cluster: 'devnet',
  disableFeatureCheck: true,
  disableLoadToken: true,
  blockhashCommitment: 'confirmed'
})

function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
}

function accountMeta(pubkey: PublicKey, isSigner = false, isWritable = false) {
  return { pubkey, isSigner, isWritable }
}

function encodeU64(value: number): Buffer {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(BigInt(value))
  return bytes
}

function makeInstruction(name: string, keys: ReturnType<typeof accountMeta>[], args = Buffer.alloc(0)): TransactionInstruction {
  return new TransactionInstruction({ programId, keys, data: Buffer.concat([discriminator(name), args]) })
}

const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from('share-mint')], programId)
const [userPosition] = PublicKey.findProgramAddressSync([Buffer.from('user'), config.toBuffer(), owner.publicKey.toBuffer()], programId)
const inputMint = new PublicKey(input.mint)
const outputMint = new PublicKey(output.mint)
const vaultInput = await getAssociatedTokenAddress(inputMint, config, true)
const vaultOutput = await getAssociatedTokenAddress(outputMint, config, true)
const userInput = await getAssociatedTokenAddress(inputMint, owner.publicKey)
const configAccount = await connection.getAccountInfo(config, 'confirmed')

if (!configAccount) {
  const initVaultArgs = Buffer.from([input.decimals])
  const initVaultIx = makeInstruction('initialize_vault', [
    accountMeta(config, false, true),
    accountMeta(owner.publicKey, true, true),
    accountMeta(inputMint),
    accountMeta(shareMint, false, true),
    accountMeta(vaultInput, false, true),
    accountMeta(TOKEN_PROGRAM_ID),
    accountMeta(new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')),
    accountMeta(SystemProgram.programId),
    accountMeta(new PublicKey('SysvarRent111111111111111111111111111111111'))
  ], initVaultArgs)
  await sendAndConfirmTransaction(connection, new Transaction().add(initVaultIx), [owner], { commitment: 'confirmed' })
} else {
  if (!configAccount.owner.equals(programId) || configAccount.data.length < 139) throw new Error('The vault config account is invalid.')
  const admin = new PublicKey(configAccount.data.subarray(8, 40))
  const assetMint = new PublicKey(configAccount.data.subarray(40, 72))
  if (!admin.equals(owner.publicKey)) throw new Error('The existing vault admin does not match the configured wallet.')
  if (!assetMint.equals(inputMint)) throw new Error('The existing vault uses a different input mint.')
}

if (!(await connection.getAccountInfo(userPosition, 'confirmed'))) {
  const initUserIx = makeInstruction('initialize_user', [
    accountMeta(config),
    accountMeta(shareMint),
    accountMeta(owner.publicKey, true, true),
    accountMeta(userPosition, false, true),
    accountMeta(await getAssociatedTokenAddress(shareMint, owner.publicKey), false, true),
    accountMeta(TOKEN_PROGRAM_ID),
    accountMeta(new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')),
    accountMeta(SystemProgram.programId),
    accountMeta(new PublicKey('SysvarRent111111111111111111111111111111111'))
  ])
  await sendAndConfirmTransaction(connection, new Transaction().add(initUserIx), [owner], { commitment: 'confirmed' })
}

await getOrCreateAssociatedTokenAccount(connection, owner, inputMint, owner.publicKey)
await getOrCreateAssociatedTokenAccount(connection, owner, outputMint, config, true)
const userInputAccount = await getAccount(connection, userInput, 'confirmed')
if (userInputAccount.amount < BigInt(depositAmount)) throw new Error(`Not enough STUDENT_A to deposit. Available raw amount: ${userInputAccount.amount.toString()}`)

const depositArgs = Buffer.concat([encodeU64(depositAmount), encodeU64(1)])
const depositIx = makeInstruction('deposit', [
  accountMeta(config),
  accountMeta(inputMint),
  accountMeta(vaultInput, false, true),
  accountMeta(shareMint, false, true),
  accountMeta(owner.publicKey, true),
  accountMeta(userInput, false, true),
  accountMeta(userPosition, false, true),
  accountMeta(await getAssociatedTokenAddress(shareMint, owner.publicKey), false, true),
  accountMeta(TOKEN_PROGRAM_ID)
], depositArgs)
await sendAndConfirmTransaction(connection, new Transaction().add(depositIx), [owner], { commitment: 'confirmed' })

const poolId = new PublicKey(saved.pool)
const { poolInfo, rpcData, tickArrays } = await raydium.clmm.getSwapPoolInfo(poolId)
if (![poolInfo.mintA.address, poolInfo.mintB.address].includes(inputMint.toBase58()) || ![poolInfo.mintA.address, poolInfo.mintB.address].includes(outputMint.toBase58())) {
  throw new Error('The Week 11 token mints do not match the selected Raydium pool.')
}

const poolInputVault = rpcData.mintA.equals(inputMint) ? rpcData.vaultA : rpcData.vaultB
const poolOutputVault = rpcData.mintA.equals(outputMint) ? rpcData.vaultA : rpcData.vaultB
const swapKeys = [
  accountMeta(config),
  accountMeta(owner.publicKey, true),
  accountMeta(inputMint),
  accountMeta(outputMint),
  accountMeta(vaultInput, false, true),
  accountMeta(vaultOutput, false, true),
  accountMeta(rpcData.configId),
  accountMeta(poolId, false, true),
  accountMeta(poolInputVault, false, true),
  accountMeta(poolOutputVault, false, true),
  accountMeta(rpcData.observationId, false, true),
  accountMeta(TOKEN_PROGRAM_ID),
  accountMeta(TOKEN_2022_PROGRAM_ID),
  accountMeta(MEMO_PROGRAM_ID),
  accountMeta(DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID)
]
const tickArrayMetas = tickArrays.map((item) => accountMeta(item.address, false, true))
const swapIx = makeInstruction('swap_via_clmm', swapKeys, Buffer.concat([encodeU64(amountIn), encodeU64(minAmountOut)]))
swapIx.keys.push(...tickArrayMetas)

const inputBefore = await getAccount(connection, vaultInput, 'confirmed')
const outputBefore = await getAccount(connection, vaultOutput, 'confirmed')
if (inputBefore.amount < BigInt(amountIn)) throw new Error(`Vault has insufficient STUDENT_A. Available raw amount: ${inputBefore.amount.toString()}`)
const signature = await sendAndConfirmTransaction(connection, new Transaction().add(swapIx), [owner], { commitment: 'confirmed' })
const inputAfter = await getAccount(connection, vaultInput, 'confirmed')
const outputAfter = await getAccount(connection, vaultOutput, 'confirmed')
const actualInput = inputBefore.amount - inputAfter.amount
const actualOutput = outputAfter.amount - outputBefore.amount

if (actualInput !== BigInt(amountIn)) throw new Error(`Unexpected vault input change: expected ${amountIn}, received ${actualInput.toString()}`)
if (actualOutput < BigInt(minAmountOut)) throw new Error(`Slippage check failed: received ${actualOutput.toString()}, minimum was ${minAmountOut}`)

const result = {
  network: 'devnet',
  owner: owner.publicKey.toBase58(),
  vaultProgram: programId.toBase58(),
  vaultConfig: config.toBase58(),
  vaultInput: vaultInput.toBase58(),
  vaultOutput: vaultOutput.toBase58(),
  pool: poolId.toBase58(),
  input: { symbol: input.symbol, mint: input.mint, amount: amountInUi, rawAmount: amountIn.toString() },
  output: { symbol: output.symbol, mint: output.mint, amountRaw: actualOutput.toString() },
  minAmountOut: minAmountOut.toString(),
  slippageBps,
  inputBalanceBefore: inputBefore.amount.toString(),
  inputBalanceAfter: inputAfter.amount.toString(),
  outputBalanceBefore: outputBefore.amount.toString(),
  outputBalanceAfter: outputAfter.amount.toString(),
  signature
}

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
