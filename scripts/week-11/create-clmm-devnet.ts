import 'dotenv/config'
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js'
import { Raydium, DEVNET_PROGRAM_ID, TxVersion, getPdaAmmConfigId, TickUtil, type ApiV3Token } from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'
import Decimal from 'decimal.js'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const rpcUrl = process.env.SOLANA_RPC_URL ?? (process.env.HELIUS_API_KEY ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : clusterApiUrl('devnet'))
const keypairPath = process.env.SOLANA_KEYPAIR ?? resolve(homedir(), '.config/solana/id.json')
const secretKey = Uint8Array.from(JSON.parse(await readFile(keypairPath, 'utf8')) as number[])
const owner = Keypair.fromSecretKey(secretKey)
const connection = new Connection(rpcUrl, 'confirmed')
const balance = await connection.getBalance(owner.publicKey, 'confirmed')
if (balance < 0.25 * 1_000_000_000) {
  const airdropSignature = await connection.requestAirdrop(owner.publicKey, 2 * 1_000_000_000)
  const latestBlockhash = await connection.getLatestBlockhash('confirmed')
  await connection.confirmTransaction({ signature: airdropSignature, ...latestBlockhash }, 'confirmed')
}

const mintA = await createMint(connection, owner, owner.publicKey, null, 6)
const mintB = await createMint(connection, owner, owner.publicKey, null, 6)
const tokenA = await getOrCreateAssociatedTokenAccount(connection, owner, mintA, owner.publicKey)
const tokenB = await getOrCreateAssociatedTokenAccount(connection, owner, mintB, owner.publicKey)
await mintTo(connection, owner, mintA, tokenA.address, owner, 1_000_000_000_000n)
await mintTo(connection, owner, mintB, tokenB.address, owner, 1_000_000_000_000n)

const raydium = await Raydium.load({
  owner,
  connection,
  cluster: 'devnet',
  disableFeatureCheck: true,
  disableLoadToken: true,
  blockhashCommitment: 'confirmed'
})
const configInfo = (await raydium.api.getClmmConfigs())[0]
if (!configInfo) throw new Error('Raydium devnet did not return a CLMM configuration.')
const configId = getPdaAmmConfigId(DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID, configInfo.index).publicKey
const configAccount = await connection.getAccountInfo(configId, 'confirmed')
if (!configAccount) throw new Error(`CLMM configuration account ${configId.toBase58()} is missing on devnet.`)
const ammConfig = {
  id: configId,
  index: configInfo.index,
  protocolFeeRate: configInfo.protocolFeeRate,
  tradeFeeRate: configInfo.tradeFeeRate,
  tickSpacing: configInfo.tickSpacing,
  fundFeeRate: configInfo.fundFeeRate,
  fundOwner: owner.publicKey.toBase58(),
  description: 'Raydium CLMM devnet configuration'
}
const tokenAInfo: ApiV3Token = { chainId: 103, address: mintA.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), logoURI: '', symbol: 'STUDENT_A', name: 'Student Token A', decimals: 6, tags: [], extensions: {} }
const tokenBInfo: ApiV3Token = { chainId: 103, address: mintB.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), logoURI: '', symbol: 'STUDENT_B', name: 'Student Token B', decimals: 6, tags: [], extensions: {} }
const poolCreation = await raydium.clmm.createPool({
  programId: DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID,
  mint1: tokenAInfo,
  mint2: tokenBInfo,
  ammConfig,
  initialPrice: new Decimal.Decimal(1),
  txVersion: TxVersion.V0
})
const poolResult = await poolCreation.execute({ sendAndConfirm: true })
const poolSignature = poolResult.txId
const poolId = new PublicKey(poolCreation.extInfo.address.id)
const poolData = await raydium.clmm.getPoolInfoFromRpc(poolId.toBase58())
const rangeLower = new Decimal.Decimal('0.9')
const rangeUpper = new Decimal.Decimal('1.1')
const tickLower = TickUtil.priceToTick(rangeLower, 6, 6)
const tickUpper = TickUtil.priceToTick(rangeUpper, 6, 6)
const position = await raydium.clmm.openPositionFromBase({
  poolInfo: poolData.poolInfo as never,
  poolKeys: poolData.poolKeys,
  ownerInfo: { useSOLBalance: true },
  tickLower,
  tickUpper,
  base: 'MintA',
  baseAmount: new BN('100000000'),
  otherAmountMax: new BN('110000000'),
  txVersion: TxVersion.V0
})
const positionResult = await position.execute({ sendAndConfirm: true })
const positionSignature = positionResult.txId
const result = {
  network: 'devnet',
  owner: owner.publicKey.toBase58(),
  tokens: [{ symbol: 'STUDENT_A', mint: mintA.toBase58(), decimals: 6 }, { symbol: 'STUDENT_B', mint: mintB.toBase58(), decimals: 6 }],
  pool: poolId.toBase58(),
  initialPrice: '1 STUDENT_B per STUDENT_A',
  position: { tickLower, tickUpper, priceLower: rangeLower.toString(), priceUpper: rangeUpper.toString(), baseAmount: '100 STUDENT_A' },
  signatures: { pool: poolSignature, position: positionSignature }
}
await writeFile('week-11-devnet-results.json', `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
