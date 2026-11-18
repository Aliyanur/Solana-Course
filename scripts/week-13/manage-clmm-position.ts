import 'dotenv/config'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { getAccount, getAssociatedTokenAddress, transfer } from '@solana/spl-token'
import { AddressLookupTableProgram, Connection, Keypair, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js'
import { ClmmInstrument, DEVNET_PROGRAM_ID, getPdaPersonalPositionAddress, getPdaTickArrayAddress, PersonalPositionLayout, PositionUtils, Raydium, TickArrayLayout, TickArrayUtil, TickUtil, TxVersion } from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import { Decimal } from 'decimal.js'

const vaultProgramId = new PublicKey('5Mt5EcuiqoizEPsFC6Rqz7ZwoVTAdMzbvHLiDB4DxoNH')
const clmmProgramId = DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID
const rpcUrl = process.env.SOLANA_RPC_URL ?? (process.env.HELIUS_API_KEY ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : clusterApiUrl('devnet'))
const keypairPath = process.env.SOLANA_KEYPAIR ?? resolve(homedir(), '.config/solana/id.json')
const outputPath = 'week-13-devnet-results.json'
const lookupTablePath = 'week-13-address-table.json'
const previousPath = 'week-12-devnet-results.json'
const fundUi = Number(process.env.WEEK13_FUND_AMOUNT ?? '20')
const positionAmountUi = Number(process.env.WEEK13_POSITION_AMOUNT ?? '5')
const rangeBps = Number(process.env.WEEK13_RANGE_BPS ?? '60')

if (!Number.isFinite(fundUi) || fundUi <= 0 || !Number.isFinite(positionAmountUi) || positionAmountUi <= 0 || !Number.isInteger(rangeBps) || rangeBps < 1) {
  throw new Error('Week 13 fund amount, position amount and range are invalid.')
}

const [secretKey, previous] = await Promise.all([
  readFile(keypairPath, 'utf8').then((value) => Uint8Array.from(JSON.parse(value) as number[])),
  readFile(previousPath, 'utf8').then((value) => JSON.parse(value) as {
    owner: string
    pool: string
    vaultProgram: string
    tokens?: { symbol: string; mint: string; decimals: number }[]
  })
])

if (previous.vaultProgram !== vaultProgramId.toBase58()) throw new Error('Week 12 vault program ID does not match.')
const owner = Keypair.fromSecretKey(secretKey)
if (owner.publicKey.toBase58() !== previous.owner) throw new Error('The configured wallet is not the Week 12 vault admin.')

const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], vaultProgramId)
const poolId = new PublicKey(previous.pool)
const connection = new Connection(rpcUrl, 'confirmed')
const raydium = await Raydium.load({ owner, connection, cluster: 'devnet', disableFeatureCheck: true, disableLoadToken: true, blockhashCommitment: 'confirmed' })
const [{ poolInfo, poolKeys }, { poolInfo: simplePoolInfo }] = await Promise.all([
  raydium.clmm.getPoolInfoFromRpc(poolId.toBase58()),
  raydium.clmm.getSimplePoolInfo(poolId.toBase58())
])
const tokenA = { mint: new PublicKey(poolInfo.mintA.address), decimals: poolInfo.mintA.decimals }
const tokenB = { mint: new PublicKey(poolInfo.mintB.address), decimals: poolInfo.mintB.decimals }
const vaultTokenA = await getAssociatedTokenAddress(tokenA.mint, config, true)
const vaultTokenB = await getAssociatedTokenAddress(tokenB.mint, config, true)
const adminTokenA = await getAssociatedTokenAddress(tokenA.mint, owner.publicKey)
const adminTokenB = await getAssociatedTokenAddress(tokenB.mint, owner.publicKey)
const configAccount = await connection.getAccountInfo(config, 'confirmed')
if (!configAccount || !configAccount.owner.equals(vaultProgramId)) throw new Error('The Week 12 vault is not initialized on devnet.')

const fundRaw = BigInt(Math.round(fundUi * 10 ** Math.max(tokenA.decimals, tokenB.decimals)))
const fundingSignatures: string[] = []
for (const [source, destination, mint] of [[adminTokenA, vaultTokenA, tokenA.mint], [adminTokenB, vaultTokenB, tokenB.mint]] as const) {
  const [sourceAccount, destinationAccount] = await Promise.all([getAccount(connection, source, 'confirmed'), getAccount(connection, destination, 'confirmed')])
  const needed = fundRaw > destinationAccount.amount ? fundRaw - destinationAccount.amount : 0n
  if (needed > 0n) {
    if (sourceAccount.amount < needed) throw new Error(`Not enough admin token balance to fund ${mint.toBase58()}.`)
    fundingSignatures.push(await transfer(connection, owner, source, destination, owner, needed))
  }
}

function discriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
}

function u32(value: number): Buffer {
  const result = Buffer.alloc(4)
  result.writeUInt32LE(value)
  return result
}

function serializeCpi(ix: TransactionInstruction): Buffer {
  const accountKeys = ix.keys.map((key) => key.pubkey)
  const flags = ix.keys.map((key) => (key.isSigner ? 1 : 0) | (key.isWritable ? 2 : 0))
  return Buffer.concat([
    discriminator('manage_clmm_position'),
    u32(ix.data.length), ix.data,
    u32(flags.length), Buffer.from(flags)
  ])
}

async function ensureLookupTable(keys: PublicKey[]) {
  let lookupAddress: PublicKey | undefined
  try {
    const saved = JSON.parse(await readFile(lookupTablePath, 'utf8')) as { address: string }
    lookupAddress = new PublicKey(saved.address)
  } catch {}
  if (!lookupAddress) {
    const recentSlot = await connection.getSlot('confirmed')
    const [createIx, address] = AddressLookupTableProgram.createLookupTable({ authority: owner.publicKey, payer: owner.publicKey, recentSlot })
    await sendAndConfirmTransaction(connection, new Transaction().add(createIx), [owner], { commitment: 'confirmed' })
    lookupAddress = address
    await writeFile(lookupTablePath, `${JSON.stringify({ address: address.toBase58() }, null, 2)}\n`)
  }
  let table = await connection.getAddressLookupTable(lookupAddress, { commitment: 'confirmed' })
  if (!table.value) throw new Error('Week 13 address lookup table was not found.')
  const present = new Set(table.value.state.addresses.map((key) => key.toBase58()))
  const missing = [...new Map(keys.map((key) => [key.toBase58(), key])).values()].filter((key) => !present.has(key.toBase58()))
  for (let offset = 0; offset < missing.length; offset += 20) {
    const extendIx = AddressLookupTableProgram.extendLookupTable({
      payer: owner.publicKey,
      authority: owner.publicKey,
      lookupTable: lookupAddress,
      addresses: missing.slice(offset, offset + 20)
    })
    await sendAndConfirmTransaction(connection, new Transaction().add(extendIx), [owner], { commitment: 'confirmed' })
    table = await connection.getAddressLookupTable(lookupAddress, { commitment: 'confirmed' })
    if (!table.value) throw new Error('Week 13 address lookup table was not found after extension.')
    while (await connection.getSlot('confirmed') <= table.value.state.lastExtendedSlot) await new Promise((resolve) => setTimeout(resolve, 400))
  }
  table = await connection.getAddressLookupTable(lookupAddress, { commitment: 'confirmed' })
  if (!table.value) throw new Error('Week 13 address lookup table was not found after activation.')
  return table.value
}

async function callPositionCpi(ix: TransactionInstruction, nftMint: PublicKey, nftAccount: PublicKey, signers: Keypair[] = []): Promise<string> {
  if (!ix.programId.equals(clmmProgramId)) throw new Error('Expected a Raydium CLMM instruction.')
  const outerKeys = [
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: owner.publicKey, isSigner: true, isWritable: true },
    { pubkey: nftMint, isSigner: ix.keys.some((key) => key.pubkey.equals(nftMint) && key.isSigner), isWritable: ix.keys.some((key) => key.pubkey.equals(nftMint) && key.isWritable) },
    { pubkey: nftAccount, isSigner: false, isWritable: true },
    { pubkey: vaultTokenA, isSigner: false, isWritable: true },
    { pubkey: vaultTokenB, isSigner: false, isWritable: true },
    { pubkey: clmmProgramId, isSigner: false, isWritable: false },
    ...ix.keys.map((key) => ({ ...key, isSigner: key.isSigner && signers.some((signer) => signer.publicKey.equals(key.pubkey)) }))
  ]
  const wrapper = new TransactionInstruction({ programId: vaultProgramId, keys: outerKeys, data: serializeCpi(ix) })
  const lookupTable = await ensureLookupTable(outerKeys.filter((key) => !key.isSigner).map((key) => key.pubkey))
  const latest = await connection.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: latest.blockhash, instructions: [wrapper] }).compileToV0Message([lookupTable])
  const transaction = new VersionedTransaction(message)
  transaction.sign([owner, ...signers])
  const signature = await connection.sendRawTransaction(transaction.serialize(), { maxRetries: 3, preflightCommitment: 'confirmed' })
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'confirmed')
  if (confirmation.value.err) throw new Error(`Vault CLMM CPI failed: ${JSON.stringify(confirmation.value.err)}`)
  return signature
}

async function findRange(price: number) {
  const percent = rangeBps / 10000
  const spacing = poolInfo.config.tickSpacing
  const lower = TickUtil.getPriceAndTick({ price: new Decimal(price * (1 - percent)), mintADecimals: tokenA.decimals, mintBDecimals: tokenB.decimals, zeroForOne: true, tickSpacing: spacing })
  const upper = TickUtil.getPriceAndTick({ price: new Decimal(price * (1 + percent)), mintADecimals: tokenA.decimals, mintBDecimals: tokenB.decimals, zeroForOne: true, tickSpacing: spacing })
  return { tickLower: Math.min(lower.tick, upper.tick), tickUpper: Math.max(lower.tick, upper.tick), priceLower: lower.price.toString(), priceUpper: upper.price.toString() }
}

async function openPosition() {
  const poolState = await raydium.clmm.getRpcClmmPoolInfo({ poolId })
  const range = await findRange(poolState.currentPrice)
  const baseAmount = new BN(Math.round(positionAmountUi * 10 ** tokenA.decimals))
  const position = await ClmmInstrument.openPositionFromBaseInstructions({
    poolInfo: simplePoolInfo,
    poolKeys,
    ownerInfo: { feePayer: owner.publicKey, wallet: config, tokenAccountA: vaultTokenA, tokenAccountB: vaultTokenB },
    tickLower: range.tickLower,
    tickUpper: range.tickUpper,
    base: 'MintA',
    baseAmount,
    otherAmountMax: baseAmount.muln(2),
    liquidity: new BN(0),
    withMetadata: 'no-create'
  })
  const nftMint = position.address.nftMint
  const nftAccount = position.address.positionNftAccount
  const expectedNftAccount = await getAssociatedTokenAddress(nftMint, config, true)
  if (!expectedNftAccount.equals(nftAccount)) throw new Error('Raydium position NFT account is not owned by the vault PDA.')
  const ix = position.instructions.find((instruction) => instruction.programId.equals(clmmProgramId))
  if (!ix) throw new Error('Raydium SDK did not create an open-position instruction.')
  const signature = await callPositionCpi(ix, nftMint, nftAccount, position.signers as Keypair[])
  return { nftMint, nftAccount, personalPosition: position.address.personalPosition, tickArrayLower: position.address.tickArrayLower, tickArrayUpper: position.address.tickArrayUpper, tickLower: range.tickLower, tickUpper: range.tickUpper, priceLower: range.priceLower, priceUpper: range.priceUpper, signature }
}

async function movePrice(amountUi: number) {
  const amountIn = Math.round(amountUi * 10 ** tokenB.decimals)
  const minimumOut = Math.floor(amountIn * 0.3)
  const swapInfo = await raydium.clmm.getSwapPoolInfo(poolId)
  const swap = await raydium.clmm.swap({
    poolInfo: swapInfo.poolInfo,
    inputMint: tokenB.mint,
    amountIn: new BN(amountIn),
    amountOutMin: new BN(minimumOut),
    observationId: swapInfo.rpcData.observationId,
    remainingAccounts: swapInfo.tickArrays.map((tickArray) => tickArray.address),
    ownerInfo: { useSOLBalance: false },
    txVersion: TxVersion.V0
  })
  const result = await swap.execute({ sendAndConfirm: true })
  return Array.isArray(result.txId) ? result.txId[0] : result.txId
}

async function accruedFees(positionMint: PublicKey) {
  const positionAddress = getPdaPersonalPositionAddress(clmmProgramId, positionMint).publicKey
  const positionAccount = await connection.getAccountInfo(positionAddress, 'confirmed')
  if (!positionAccount) throw new Error('Raydium personal position account was not found.')
  const position = PersonalPositionLayout.decode(positionAccount.data)
  const currentPool = await raydium.clmm.getRpcClmmPoolInfo({ poolId })
  const lowerAddress = getPdaTickArrayAddress(clmmProgramId, poolId, TickArrayUtil.getTickArrayStartIndex(position.tickLower, currentPool.tickSpacing)).publicKey
  const upperAddress = getPdaTickArrayAddress(clmmProgramId, poolId, TickArrayUtil.getTickArrayStartIndex(position.tickUpper, currentPool.tickSpacing)).publicKey
  const [lowerInfo, upperInfo] = await connection.getMultipleAccountsInfo([lowerAddress, upperAddress], 'confirmed')
  if (!lowerInfo || !upperInfo) throw new Error('Position tick arrays were not found.')
  const lower = TickArrayLayout.decode(lowerInfo.data).ticks.find((tick) => tick.tick === position.tickLower)
  const upper = TickArrayLayout.decode(upperInfo.data).ticks.find((tick) => tick.tick === position.tickUpper)
  if (!lower || !upper) throw new Error('Position boundary ticks were not initialized.')
  const fees = PositionUtils.GetPositionFees(currentPool, position, lower, upper)
  return { positionAddress, position, tickCurrent: currentPool.tickCurrent, feesA: fees.tokenFeeAmountA, feesB: fees.tokenFeeAmountB }
}

async function decreaseAndClose(position: Awaited<ReturnType<typeof openPosition>>) {
  const info = await accruedFees(position.nftMint)
  const feeTotal = info.feesA.add(info.feesB)
  if (feeTotal.isZero()) throw new Error('No CLMM fees accrued yet. The vault position is kept open; trade more volume while price is in range, then rerun.')
  const decrease = ClmmInstrument.decreaseLiquidityInstructions({
    poolInfo,
    poolKeys,
    ownerPosition: info.position,
    ownerInfo: { wallet: config, tokenAccountA: vaultTokenA, tokenAccountB: vaultTokenB, rewardAccounts: [] },
    liquidity: info.position.liquidity,
    amountMinA: new BN(0),
    amountMinB: new BN(0)
  })
  const decreaseIx = decrease.instructions.find((instruction) => instruction.programId.equals(clmmProgramId))
  if (!decreaseIx) throw new Error('Raydium SDK did not create a decrease-liquidity instruction.')
  const decreaseSignature = await callPositionCpi(decreaseIx, position.nftMint, position.nftAccount)
  const refreshed = await accruedFees(position.nftMint)
  const close = ClmmInstrument.closePositionInstructions({ poolInfo, poolKeys, ownerInfo: { wallet: config }, ownerPosition: refreshed.position })
  const closeIx = close.instructions.find((instruction) => instruction.programId.equals(clmmProgramId))
  if (!closeIx) throw new Error('Raydium SDK did not create a close-position instruction.')
  const closeSignature = await callPositionCpi(closeIx, position.nftMint, position.nftAccount)
  return { decreaseSignature, closeSignature, feesA: info.feesA.toString(), feesB: info.feesB.toString(), feeTotal: feeTotal.toString() }
}

const initialPosition = await openPosition()
const priceMoves: { amount: number; signature: string; currentTick: number; inRange: boolean }[] = []
let rangeExited = false
for (const amount of [10, 20, 30]) {
  const signature = await movePrice(amount)
  const state = await raydium.clmm.getRpcClmmPoolInfo({ poolId })
  const inRange = state.tickCurrent >= initialPosition.tickLower && state.tickCurrent < initialPosition.tickUpper
  priceMoves.push({ amount, signature, currentTick: state.tickCurrent, inRange })
  if (!inRange) {
    rangeExited = true
    break
  }
}
if (!rangeExited) throw new Error('Devnet price stayed inside the initial range. The first position remains open; try a larger WEEK13_RANGE_BPS or trade amount.')

const collection = await decreaseAndClose(initialPosition)
const replacementPosition = await openPosition()
const vaultBalanceA = await getAccount(connection, vaultTokenA, 'confirmed')
const vaultBalanceB = await getAccount(connection, vaultTokenB, 'confirmed')
const result = {
  network: 'devnet',
  owner: owner.publicKey.toBase58(),
  vaultProgram: vaultProgramId.toBase58(),
  vaultConfig: config.toBase58(),
  pool: poolId.toBase58(),
  tokenA: { mint: tokenA.mint.toBase58(), vaultAccount: vaultTokenA.toBase58() },
  tokenB: { mint: tokenB.mint.toBase58(), vaultAccount: vaultTokenB.toBase58() },
  funding: { amountEach: fundUi.toString(), signatures: fundingSignatures },
  initialPosition: { ...initialPosition, nftMint: initialPosition.nftMint.toBase58(), nftAccount: initialPosition.nftAccount.toBase58(), personalPosition: initialPosition.personalPosition.toBase58(), tickArrayLower: initialPosition.tickArrayLower.toBase58(), tickArrayUpper: initialPosition.tickArrayUpper.toBase58() },
  priceMoves,
  collectedFeesRaw: { tokenA: collection.feesA, tokenB: collection.feesB, total: collection.feeTotal },
  decreaseSignature: collection.decreaseSignature,
  closeSignature: collection.closeSignature,
  replacementPosition: { ...replacementPosition, nftMint: replacementPosition.nftMint.toBase58(), nftAccount: replacementPosition.nftAccount.toBase58(), personalPosition: replacementPosition.personalPosition.toBase58(), tickArrayLower: replacementPosition.tickArrayLower.toBase58(), tickArrayUpper: replacementPosition.tickArrayUpper.toBase58() },
  finalVaultBalancesRaw: { tokenA: vaultBalanceA.amount.toString(), tokenB: vaultBalanceB.amount.toString() }
}

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
