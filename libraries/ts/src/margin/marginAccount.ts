import assert from 'assert';
import * as BufferLayout from 'buffer-layout';
import { AccountsCoder, BN, BorshAccountsCoder, InstructionCoder, InstructionNamespace } from '@project-serum/anchor';
import { AccountLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';

import { MarginPool } from './pool';
import { ConnectionOptions } from '../types';
import { IDL as MarginIDL, JetMargin } from '../types/jet_margin';
import { IDL as MetadataIDL, JetMetadata } from '../types/jet_metadata';
import { buildAccounts, buildInstructions } from '../utils/idlBuilder';
import * as Layout from "../utils/layout";

const MAX_POSITIONS = 32;

const AccountPositionKeyLayout: typeof BufferLayout.Structure = BufferLayout.struct([
  Layout.publicKey('mint'),
  Layout.uint64('index'),
]);

export const PriceInfoLayout: typeof BufferLayout.Structure = BufferLayout.struct([
  BufferLayout.ns64('value'),
  Layout.uint64('timestamp'),
  BufferLayout.s32('exponent'),
  BufferLayout.u8('isValid'),
  BufferLayout.blob(3, 'reserved'),
]);

const AccountPositionLayout: typeof BufferLayout.Structure = BufferLayout.struct([
  Layout.publicKey('token'),
  Layout.publicKey('address'),
  Layout.publicKey('adapter'),
  Layout.uint128('value'),
  Layout.uint64('balance'),
  Layout.uint64('balanceTimestamp'),
  PriceInfoLayout,
  BufferLayout.u32('kind'),
  BufferLayout.s16('exponent'),
  BufferLayout.u16('collateralWeight'),
  Layout.uint64('collateralMaxStaleness'),
  BufferLayout.blob(24, 'reserved'),
]);

const AccountPositionListLayout: typeof BufferLayout.Structure = BufferLayout.struct([
  Layout.uint64('length'),
  BufferLayout.seq(AccountPositionKeyLayout, MAX_POSITIONS, 'map'),
  BufferLayout.seq(AccountPositionLayout, MAX_POSITIONS, 'positions'),
]);

export class MarginAccount {

  /// The account owner
  owner: Account;

  /// The account paying for any rent
  //@ts-ignore
  payer: Account;

  /// The address of the margin account for the owner
  //@ts-ignore
  address: PublicKey;

  /// The bump seed to generate the address
  //@ts-ignore
  bump_seed: number;

  private _controlProgramId: PublicKey;
  private _marginProgramId: PublicKey;
  private _metadataProgramId: PublicKey;

  private _skipPreflight: boolean;
  private _commitment: Commitment;

  private marginInstructions: InstructionNamespace<JetMargin>;
  private metadataAccounts;
  private metadataInstructions: InstructionNamespace<JetMetadata>;

  private positions;

  constructor(
    options: ConnectionOptions,
    owner: Account,
    payer: Account,
    address: PublicKey,
    bump_seed: number,
    controlProgramId: PublicKey,
    marginProgramId: PublicKey,
    metadataProgramId: PublicKey,
  ) {
    this._controlProgramId = controlProgramId;
    this._marginProgramId = marginProgramId;
    this._metadataProgramId = metadataProgramId;

    const { skipPreflight = false, commitment = 'recent' } = options;
    this._skipPreflight = skipPreflight;
    this._commitment = commitment;

    this.owner = owner;
    this.payer = payer;
    this.address = address;
    this.bump_seed = bump_seed;

    this.marginInstructions = buildInstructions(MarginIDL, marginProgramId) as InstructionNamespace<JetMargin>;
    this.metadataAccounts = buildAccounts(MetadataIDL);
    this.metadataInstructions = buildInstructions(MetadataIDL, metadataProgramId) as InstructionNamespace<JetMetadata>;
  }

  static async load(
    owner: Account,
    seed: number,
    controlProgramId: PublicKey,
    marginProgramId: PublicKey,
    marginMetadataProgramId: PublicKey,
  ) {
    const seed_buf = Buffer.allocUnsafe(2);
    seed_buf.writeInt16BE(seed);
    const [ address, bump_seed ] = await PublicKey.findProgramAddress([owner.publicKey.toBuffer(), seed_buf], marginProgramId);
    const marginAccount = new MarginAccount({}, owner, owner, address, bump_seed, controlProgramId, marginProgramId, marginMetadataProgramId);
    return marginAccount;
  }

  async createAccount(
    connection: Connection,
    seed: number,
  ) {
    const tx = new Transaction();
    tx.add(
      await this.makeCreateAccountInstruction(seed),
    );
    return await this.sendTransaction(connection, tx, [this.owner, this.payer]);
  }

  /// Get instruction to create the account
  async makeCreateAccountInstruction(seed: number): Promise<TransactionInstruction> {
    return this.marginInstructions.createAccount(seed, {
      accounts: {
        owner: this.owner.publicKey,
        payer: this.payer.publicKey,
        marginAccount: this.address,
        systemProgram: SystemProgram.programId,
      },
    });
  }

  //Deposit
  /// Transaction to deposit tokens into a margin account
  ///
  /// # Params
  ///
  /// `token_mint` - The address of the mint for the tokens being deposited
  /// `source` - The token account that the deposit will be transfered from
  /// `amount` - The amount of tokens to deposit
  async deposit(
    connection: Connection,
    marginPool: MarginPool,
    source: PublicKey,
    amount: BN,
  ) {
    await this.refresh(connection);
    const position = await this.getOrCreatePosition(connection, marginPool.deposit_note_mint);
    assert(position);

    const tx = new Transaction();
    tx.add(
      await marginPool.makeDepositInstruction(this.owner.publicKey, source, position.address, amount),
      await this.makeUpdatePositionBalanceInstruction(position.address),
    );
    return await this.sendTransaction(connection, tx, [this.owner]);
  }

  //TODO Withdraw

  async getOrCreatePosition(connection: Connection, token_mint: PublicKey) {
    assert(this.positions);

    for (let i = 0; i < this.positions.length; i++) {
      const position = this.positions.positions[i];
      if (position.token.equals(token_mint)) {
        return position;
      }
    }

    await this.registerPosition(connection, token_mint);
    await this.refresh(connection);

    for (let i = 0; i < this.positions.length; i++) {
      const position = this.positions.positions[i];
      if (position.token.equals(token_mint)) {
        return position;
      }
    }

    throw new Error('Unable to register position.');
  }

  async getTokenMetadata(connection: Connection, token_mint: PublicKey) {
    const [ metadataAddress ] = await PublicKey.findProgramAddress([token_mint.toBuffer()], this._metadataProgramId);
    return this.metadataAccounts['tokenMetadata'].fetch(connection, metadataAddress);
  }

  async refresh(connection: Connection) {
    const accountInfo = await connection.getAccountInfo(this.address);
    if (accountInfo) {
      const accountsCoder: AccountsCoder = new BorshAccountsCoder(MarginIDL);
      const marginAccount = accountsCoder.decode("marginAccount", accountInfo.data);
      this.positions = AccountPositionListLayout.decode(Buffer.from(marginAccount.positions));
    } else {
      this.positions = undefined;
    }
  }

  async updatePositionBalance(
    connection: Connection,
    payer: Account,
    account: PublicKey,
  ) {
    const tx = new Transaction();
    tx.add(
      await this.makeUpdatePositionBalanceInstruction(account),
    );
    return await this.sendTransaction(connection, tx, [payer]);
  }

  /// Get instruction to update the accounting for assets in
  /// the custody of the margin account.
  ///
  /// # Params
  ///
  /// `account` - The account address that has had a balance change
  async makeUpdatePositionBalanceInstruction(account: PublicKey): Promise<TransactionInstruction> {
    return this.marginInstructions.updatePositionBalance({
      accounts: {
        marginAccount: this.address,
        tokenAccount: account,
      },
    });
  }

  async registerPosition(
    connection: Connection,
    token_mint: PublicKey,
  ): Promise<TransactionSignature> {
    let tx = new Transaction();
    const [ token_account, ix ] = await this.makeRegisterPositionInstruction(token_mint);
    tx.add(ix);
    return this.sendTransaction(connection, tx, [this.owner, this.payer]);
  }

  /// Get instruction to register new position
  ///
  /// # Params
  ///
  /// `token_mint` - The mint for the relevant token for the position
  /// `token_oracle` - The oracle account with price information on the token
  ///
  /// # Returns
  ///
  /// Returns the instruction, and the address of the token account to be
  /// created for the position.
  async makeRegisterPositionInstruction(token_mint: PublicKey): Promise<[ PublicKey, TransactionInstruction ]> {
    const [ token_account ] = await PublicKey.findProgramAddress([this.address.toBuffer(), token_mint.toBuffer()], this._marginProgramId);

    const [ metadata ] = await PublicKey.findProgramAddress([token_mint.toBuffer()], this._metadataProgramId);

    const ix = this.marginInstructions.registerPosition({
      accounts: {
        authority: this.owner.publicKey, //this.authority,
        payer: this.payer.publicKey,
        marginAccount: this.address,
        positionTokenMint: token_mint,
        metadata,
        tokenAccount: token_account,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
      },
    });
    return [ token_account, ix ];
  }

  async closePosition(
    connection: Connection,
    tokenAccount: PublicKey,
    payer: Account,
  ) {
    const tx = new Transaction();
    tx.add(
      await this.makeClosePositionInstruction(tokenAccount),
    );
    return await this.sendTransaction(connection, tx, [payer]);
  }

  /// Get instruction to close a position
  ///
  /// # Params
  ///
  /// `token_account` - The address of the token account for the position being closed
  async makeClosePositionInstruction(tokenAccount: PublicKey): Promise<TransactionInstruction> {
    const [ authority ] = await PublicKey.findProgramAddress([], this._controlProgramId);

    return this.marginInstructions.closePosition({
      accounts: {
        authority: authority,
        receiver: this.payer.publicKey,
        marginAccount: this.address,
        tokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
    });
  }

  private async sendTransaction(
    connection: Connection,
    transaction: Transaction,
    signers: Array<Account>,
  ): Promise<TransactionSignature> {
    const signature = await connection.sendTransaction(transaction, signers, {
      skipPreflight: this._skipPreflight,
    });
    const { value } = await connection.confirmTransaction(
      signature,
      this._commitment,
    );
    if (value?.err) {
      throw new Error(JSON.stringify(value.err));
    }
    return signature;
  }

  static async getTokenAccountInfo(
    connection: Connection,
    address: PublicKey,
  ) {
    const info = await connection.getAccountInfo(address);
    return AccountLayout.decode(Buffer.from(info!.data));
  }

}
