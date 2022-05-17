import { assert } from "chai";
import * as anchor from '@project-serum/anchor';
import { AnchorProvider, Provider } from '@project-serum/anchor';
import NodeWallet from '@project-serum/anchor/dist/cjs/nodewallet';
import { Account, ConfirmOptions, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';

import CONFIG from '../../libraries/ts/src/margin/config.json';
import { MarginAccount } from '../../libraries/ts/src/margin';
import { createAuthority, createUserWallet } from './util';

describe('margin account', () => {

  const controlProgramId: PublicKey = new PublicKey(CONFIG.localnet.controlProgramId);
  const marginProgramId: PublicKey = new PublicKey(CONFIG.localnet.marginProgramId);
  const metadataProgramId: PublicKey = new PublicKey(CONFIG.localnet.metadataProgramId);

  const opts: ConfirmOptions = {
    preflightCommitment: "processed",
    commitment: "processed",
  };

  const connection = new Connection("http://localhost:8899", opts.preflightCommitment);

  const payer = Keypair.generate();
  const wallet = new NodeWallet(payer);

  const provider = new AnchorProvider(connection, wallet, opts);
	anchor.setProvider(provider);

  it("Fund payer", async () => {
    const airdropSignature = await connection.requestAirdrop(payer.publicKey, 300 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropSignature);
  });

  let wallet_a: NodeWallet;
  let wallet_b: NodeWallet;

  let provider_a: Provider;
  let provider_b: Provider;

  it("Create two user wallets", async () => {
    // Create our two user wallets, with some SOL funding to get started
    wallet_a = await createUserWallet(connection, 10 * LAMPORTS_PER_SOL);
    wallet_b = await createUserWallet(connection, 10 * LAMPORTS_PER_SOL);
    provider_a = new AnchorProvider(connection, wallet_a, opts);
    provider_b = new AnchorProvider(connection, wallet_b, opts);
  });

  it("Create authority", async () => {
    await createAuthority(connection, payer);
  });

  it("Create margin accounts", async () => {
    // Initialize the margin accounts for each user
    anchor.setProvider(provider_a);
    const owner_A: Account = new Account(wallet_a.payer.secretKey);
    const maginAccount_A: MarginAccount = await MarginAccount.load(owner_A, 0, controlProgramId, marginProgramId, metadataProgramId);
    await maginAccount_A.createAccount(connection, 0);

    anchor.setProvider(provider_b);
    const owner_B: Account = new Account(wallet_b.payer.secretKey);
    const maginAccount_B: MarginAccount = await MarginAccount.load(owner_B, 0, controlProgramId, marginProgramId, metadataProgramId);
    await maginAccount_B.createAccount(connection, 0);
  });

});
