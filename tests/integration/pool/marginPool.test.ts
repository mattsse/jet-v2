import { assert } from "chai";
import * as anchor from '@project-serum/anchor';
import { AnchorProvider, BN, Provider } from '@project-serum/anchor';
import NodeWallet from '@project-serum/anchor/dist/cjs/nodewallet';
import { Account, ConfirmOptions, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import MARGIN_CONFIG from '../../../libraries/ts/src/margin/config.json';

import { MarginAccount } from '../../../libraries/ts/src/margin';
import { MarginPool } from '../../../libraries/ts/src/margin/pool/marginPool';

import { PythClient } from '../pyth/pythClient'
import { createAuthority, createToken, createTokenAccount, createUserWallet, getMintSupply, getTokenBalance, registerAdapter, sendToken } from '../util';

describe('margin account', () => {

  const controlProgramId: PublicKey = new PublicKey(MARGIN_CONFIG.localnet.controlProgramId);
  const marginProgramId: PublicKey = new PublicKey(MARGIN_CONFIG.localnet.marginProgramId);
  const marginPoolProgramId: PublicKey = new PublicKey(MARGIN_CONFIG.localnet.marginPoolProgramId);
  const metadataProgramId: PublicKey = new PublicKey(MARGIN_CONFIG.localnet.metadataProgramId);

  const opts: ConfirmOptions = { preflightCommitment: "processed", commitment: "processed" };

  const connection = new Connection("http://localhost:8899", opts.preflightCommitment);

  const payer = Keypair.generate();
  const wallet = new NodeWallet(payer);
  const ownerAccount: Account = new Account((wallet as NodeWallet).payer.secretKey);
  const ownerKeypair: Keypair = Keypair.fromSecretKey((wallet as NodeWallet).payer.secretKey);

  const provider = new AnchorProvider(connection, wallet, opts);
	anchor.setProvider(provider);

  it("Fund payer", async () => {
    const airdropSignature = await connection.requestAirdrop(payer.publicKey, 300 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropSignature);
  });



  let USDC: [PublicKey, PublicKey];
  let TSOL: [PublicKey, PublicKey];

  it("Create tokens", async () => {
    USDC = await createToken(connection, ownerKeypair, 6, 10_000_000);
    const usdc_supply = await getMintSupply(connection, USDC[0], 6);
    assert(usdc_supply > 0);
    const usdc_balance = await getTokenBalance(connection, opts.commitment, USDC[1]);
    assert(usdc_balance > 0);

    TSOL = await createToken(connection, ownerKeypair, 9, 10_000);
    const tsol_supply = await getMintSupply(connection, TSOL[0], 9);
    assert(tsol_supply > 0);
    const tsol_balance = await getTokenBalance(connection, opts.commitment, TSOL[1]);
    assert(tsol_balance > 0);
  });



  const FEE_VAULT_USDC: PublicKey = new PublicKey("FEEVAULTUSDC1111111111111111111111111111111");
  const FEE_VAULT_TSOL: PublicKey = new PublicKey("FEEVAULTTSoL1111111111111111111111111111111");



  let USDC_oracle: Keypair;
  let TSOL_oracle: Keypair;

  const pythClient = new PythClient({ pythProgramId: "ASfdvRMCan2aoWtbDi5HLXhz2CFfgEkuDoxc57bJLKLX", url: "http://127.0.0.1:8899/" });

  it("Create oracles", async () => {
    USDC_oracle = Keypair.generate();
    await pythClient.createPriceAccount(ownerKeypair, USDC_oracle, 1, 0.01, -8);
    TSOL_oracle = Keypair.generate();
    await pythClient.createPriceAccount(ownerKeypair, TSOL_oracle, 100, 1, -8);
  });



  it("Create authority", async () => {
    await createAuthority(connection, ownerKeypair);
  });

  it("Register adapter", async () => {
    await registerAdapter(connection, ownerKeypair, marginPoolProgramId, ownerKeypair);
  });



  const ONE_USDC: number = 1_000_000;
  const ONE_TSOL: number = LAMPORTS_PER_SOL;

  const DEFAULT_POOL_CONFIG = {
    borrow_rate_0: 10,
    borrow_rate_1: 20,
    borrow_rate_2: 30,
    borrow_rate_3: 40,
    utilization_rate_1: 10,
    utilization_rate_2: 20,
    management_fee_rate: 10,
    management_fee_collect_threshold: new BN(100),
    flags: new BN(2), // ALLOW_LENDING
  };

  const POOLS = [
    {
      mintAndVault: USDC,
      weight: 10_000,
      config: DEFAULT_POOL_CONFIG,
    },
    {
      mintAndVault: TSOL,
      weight: 9_500,
      config: DEFAULT_POOL_CONFIG,
    },
  ];

  let maginPool_USDC: MarginPool;
  let maginPool_TSOL: MarginPool;

  it("Create margin pools", async () => {
    maginPool_USDC = await MarginPool.load(
      USDC[0],
      controlProgramId,
      marginProgramId,
      marginPoolProgramId,
      metadataProgramId,
    );
    await maginPool_USDC.create(connection, ownerAccount.publicKey, ownerAccount, 10_000, new BN(0), FEE_VAULT_USDC, Keypair.generate().publicKey, USDC_oracle.publicKey, POOLS[0].config);

    maginPool_TSOL = await MarginPool.load(
      TSOL[0],
      controlProgramId,
      marginProgramId,
      marginPoolProgramId,
      metadataProgramId,
    );
    await maginPool_TSOL.create(connection, ownerAccount.publicKey, ownerAccount, 9_500, new BN(0), FEE_VAULT_TSOL, Keypair.generate().publicKey, TSOL_oracle.publicKey, POOLS[1].config);
  });



  let wallet_a: NodeWallet;
  let wallet_b: NodeWallet;

  let owner_A: Account;
  let owner_B: Account;

  let provider_a: Provider;
  let provider_b: Provider;

  it("Create our two user wallets, with some SOL funding to get started", async () => {
    wallet_a = await createUserWallet(connection, 10 * LAMPORTS_PER_SOL);
    wallet_b = await createUserWallet(connection, 10 * LAMPORTS_PER_SOL);

    provider_a = new AnchorProvider(connection, wallet_a, opts);
    provider_b = new AnchorProvider(connection, wallet_b, opts);

    owner_A = new Account((wallet_a as NodeWallet).payer.secretKey);
    owner_B = new Account((wallet_b as NodeWallet).payer.secretKey);
  });

  let maginAccount_A: MarginAccount;
  let maginAccount_B: MarginAccount;

  it("Initialize the margin accounts for each user", async () => {
    anchor.setProvider(provider_a);
    maginAccount_A = await MarginAccount.load(owner_A, 0, controlProgramId, marginProgramId, metadataProgramId);
    await maginAccount_A.createAccount(connection, 0);

    anchor.setProvider(provider_b);
    maginAccount_B = await MarginAccount.load(owner_B, 0, controlProgramId, marginProgramId, metadataProgramId);
    await maginAccount_B.createAccount(connection, 0);
  });

  let user_a_usdc_account;
  let user_b_tsol_account;

  it("Create some tokens for each user to deposit", async () => {
    const payer_A: Keypair = Keypair.fromSecretKey((wallet_a as NodeWallet).payer.secretKey);
    user_a_usdc_account = await createTokenAccount(connection, USDC[0], wallet_a.publicKey, payer_A);
    await sendToken(
      connection,
      USDC[0],
      1_000_000,
      6,
      ownerKeypair,
      new PublicKey(USDC[1]),
      user_a_usdc_account,
    );

    const payer_B: Keypair = Keypair.fromSecretKey((wallet_b as NodeWallet).payer.secretKey);
    user_b_tsol_account = await createTokenAccount(connection, TSOL[0], wallet_b.publicKey, payer_B);
    await sendToken(
      connection,
      TSOL[0],
      1_000,
      9,
      ownerKeypair,
      new PublicKey(TSOL[1]),
      user_b_tsol_account,
    );
  });



  it("Set the prices for each token", async () => {
    await pythClient.setPythPrice(ownerKeypair, USDC_oracle.publicKey, 1, 0.01, -8)
    await pythClient.setPythPrice(ownerKeypair, TSOL_oracle.publicKey, 100, 1, -8)
  });



  it("Deposit user funds into their margin accounts", async () => {
    await maginAccount_A.deposit(connection, maginPool_USDC, user_a_usdc_account, new BN(1_000_000 * ONE_USDC));
    assert(await getTokenBalance(connection, 'processed', user_a_usdc_account) == 0);
    await maginPool_USDC.refreshPosition(connection, maginAccount_A);

    await maginAccount_B.deposit(connection, maginPool_TSOL, user_b_tsol_account, new BN(1_000 * ONE_TSOL));
    assert(await getTokenBalance(connection, 'processed', user_b_tsol_account) == 0);
    await maginPool_TSOL.refreshPosition(connection, maginAccount_B);
  });

  it("Set the prices for each token", async () => {
    await pythClient.setPythPrice(ownerKeypair, USDC_oracle.publicKey, 1, 0.01, -8)
    await pythClient.setPythPrice(ownerKeypair, TSOL_oracle.publicKey, 100, 1, -8)
  });

  it("Have each user borrow the other's funds", async () => {
    await maginPool_TSOL.marginBorrow(connection, maginAccount_A, new BN(10 * ONE_TSOL));
    await maginPool_USDC.marginBorrow(connection, maginAccount_B, new BN(1_000 * ONE_USDC));
  });

  it("Users repay their loans", async () => {
    await maginPool_TSOL.marginRepay(connection, maginAccount_A, new BN(10 * ONE_TSOL));
    await maginPool_USDC.marginRepay(connection, maginAccount_B, new BN(1_000 * ONE_USDC));
  });

  it("Users withdraw their funds", async () => {
    await maginPool_USDC.marginWithdraw(connection, maginAccount_A, user_a_usdc_account, new BN(1_000_000 * ONE_USDC));
    await maginPool_TSOL.marginWithdraw(connection, maginAccount_B, user_b_tsol_account, new BN(1_000 * ONE_TSOL));
  });

  it("Now verify that the users got all their tokens back", async () => {
    assert(await getTokenBalance(connection, 'processed', user_a_usdc_account) == 1_000_000);
    assert(await getTokenBalance(connection, 'processed', user_b_tsol_account) == 1_000);
  });

});
