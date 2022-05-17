import assert from 'assert';
import { BN, InstructionCoder, InstructionNamespace } from '@project-serum/anchor';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
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

import { Amount } from '../../amount';
import { buildInstructions } from '../../utils/idlBuilder';
import { TokenKind } from '../../token';
import { ConnectionOptions } from '../../types';
import { IDL as JetControlIDL, JetControl } from '../../types/jet_control';
import { IDL as JetMarginIDL, JetMargin } from '../../types/jet_margin';
import { IDL as JetMarginPoolIDL, JetMarginPool } from '../../types/jet_margin_pool';
import { MarginAccount } from '../marginAccount';

export interface TokenMetadataParams {
  tokenKind: TokenKind;
  collateralWeight: number;
  collateralMaxStaleness: BN;
}

export interface MarginPoolParams {
  feeDestination: PublicKey;
}

export interface MarginPoolConfig {
  flags: BN;
  utilizationRate1: number;
  utilizationRate2: number;
  borrowRate0: number;
  borrowRate1: number;
  borrowRate2: number;
  borrowRate3: number;
  managementFeeRate: number;
  managementFeeCollectThreshold: BN;
}

export class MarginPool {

  /// The address of the mint for tokens stored in the pool
  token_mint: PublicKey;

  /// The address of the mint for tokens stored in the pool
  //@ts-ignore
  address: PublicKey;

  /// The address of the account holding the tokens in the pool
  //@ts-ignore
  vault: PublicKey;

  /// The address of the mint for deposit notes, which represent user
  /// deposit in the pool
  //@ts-ignore
  deposit_note_mint: PublicKey;

  /// The address of the oracle for deposit notes, which inform the current
  /// value of the deposit notes.
  //@ts-ignore
  deposit_note_oracle: PublicKey;

  /// The address of the mint for loan notes, which represent user borrows
  /// from the pool
  //@ts-ignore
  loan_note_mint: PublicKey;

  /// The address of the oracle for deposit notes, which inform the current
  /// value of the loan notes.
  //@ts-ignore
  loan_note_oracle: PublicKey;

  /// The bump seed to generate the address
  //@ts-ignore
  bump_seed: number;
  //@ts-ignore
  bump_seed_vault: number;
  //@ts-ignore
  bump_seed_deposit_note: number;
  //@ts-ignore
  bump_seed_deposit_note_oracle: number;
  //@ts-ignore
  bump_seed_loan_note: number;
  //@ts-ignore
  bump_seed_loan_note_oracle: number;

  private _skipPreflight: boolean;
  private _commitment: Commitment;

  private controlProgramId: PublicKey;
  private controlInstructions: InstructionNamespace<JetControl>;

  private marginInstructions: InstructionNamespace<JetMargin>;

  private marginPoolProgramId: PublicKey;
  private marginPoolInstructions: InstructionNamespace<JetMarginPool>;
  private marginPoolAdapterMetadata: PublicKey;

  private metadataProgramId: PublicKey;

  constructor(
    tokenMint: PublicKey,
    address: PublicKey,
    vault: PublicKey,
    deposit_note_mint: PublicKey,
    deposit_note_oracle: PublicKey,
    loan_note_mint: PublicKey,
    loan_note_oracle: PublicKey,
    bump_seed: number,
    bump_seed_vault: number,
    bump_seed_deposit_note: number,
    bump_seed_deposit_note_oracle: number,
    bump_seed_loan_note: number,
    bump_seed_loan_note_oracle: number,
    options: ConnectionOptions = {},
    controlProgramId: PublicKey,
    marginProgramId: PublicKey,
    marginPoolProgramId: PublicKey,
    metadataProgramId: PublicKey,
    marginPoolAdapterMetadata: PublicKey,
  ) {
    this.token_mint = tokenMint;
    this.address = address;
    this.vault = vault;
    this.deposit_note_mint = deposit_note_mint;
    this.deposit_note_oracle = deposit_note_oracle;
    this.loan_note_mint = loan_note_mint;
    this.loan_note_oracle = loan_note_oracle;
    this.bump_seed = bump_seed;
    this.bump_seed_vault = bump_seed_vault;
    this.bump_seed_deposit_note = bump_seed_deposit_note;
    this.bump_seed_deposit_note_oracle = bump_seed_deposit_note_oracle;
    this.bump_seed_loan_note = bump_seed_loan_note;
    this.bump_seed_loan_note_oracle = bump_seed_loan_note_oracle;

    const { skipPreflight = false, commitment = 'recent' } = options;
    this._skipPreflight = skipPreflight;
    this._commitment = commitment;

    assert(controlProgramId);
    this.controlProgramId = controlProgramId;
    this.controlInstructions = buildInstructions(JetControlIDL, controlProgramId) as InstructionNamespace<JetControl>;

    assert(marginProgramId);
    this.marginInstructions = buildInstructions(JetMarginIDL, marginProgramId) as InstructionNamespace<JetMargin>;

    assert(marginPoolProgramId);
    this.marginPoolProgramId = marginPoolProgramId;
    this.marginPoolInstructions = buildInstructions(JetMarginPoolIDL, marginPoolProgramId) as InstructionNamespace<JetMarginPool>;
    this.marginPoolAdapterMetadata = marginPoolAdapterMetadata;

    assert(metadataProgramId);
    this.metadataProgramId = metadataProgramId;
  }

  static async load(
    tokenMint: PublicKey,
    controlProgramId: PublicKey,
    marginProgramId: PublicKey,
    marginPoolProgramId: PublicKey,
    metadataProgramId: PublicKey,
  ) {
    assert(tokenMint);
    assert(marginPoolProgramId);
    assert(controlProgramId);
    assert(metadataProgramId);
    const [ address, bump_seed ] = await PublicKey.findProgramAddress([tokenMint.toBuffer()], marginPoolProgramId);
    const [ vault, bump_seed_vault ] = await PublicKey.findProgramAddress([address.toBuffer(), Buffer.from("vault")], marginPoolProgramId);
    const [ deposit_note_mint, bump_seed_deposit_note ] = await PublicKey.findProgramAddress([address.toBuffer(), Buffer.from("deposit-notes")], marginPoolProgramId);
    const [ deposit_note_oracle, bump_seed_deposit_note_oracle ] = await PublicKey.findProgramAddress([address.toBuffer(), Buffer.from("deposit-oracle")], marginPoolProgramId);
    const [ loan_note_mint, bump_seed_loan_note ] = await PublicKey.findProgramAddress([address.toBuffer(), Buffer.from("loan-notes")], marginPoolProgramId);
    const [ loan_note_oracle, bump_seed_loan_note_oracle ] = await PublicKey.findProgramAddress([address.toBuffer(), Buffer.from("loan-oracle")], marginPoolProgramId);
    return new MarginPool(
      tokenMint,
      address,
      vault,
      deposit_note_mint,
      deposit_note_oracle,
      loan_note_mint,
      loan_note_oracle,
      bump_seed,
      bump_seed_vault,
      bump_seed_deposit_note,
      bump_seed_deposit_note_oracle,
      bump_seed_loan_note,
      bump_seed_loan_note_oracle,
      {},
      controlProgramId,
      marginProgramId,
      marginPoolProgramId,
      metadataProgramId,
      (await PublicKey.findProgramAddress([marginPoolProgramId.toBuffer()], metadataProgramId))[0],
    );
  }

  async create(
    connection: Connection,
    requester: PublicKey,
    payer: Account,
    collateralWeight: number,
    collateralMaxStaleness: BN,
    fee_destination: PublicKey,
    pyth_product: PublicKey,
    pyth_price: PublicKey,
    marginPoolConfig,
  ) {
    const tx1 = new Transaction();
    tx1.add(
      await this.makeRegisterTokenInstruction(requester),
    );
    await this.sendTransaction(connection, tx1, [payer]);

    const tx2 = new Transaction();
    tx2.add(
      await this.makeConfigureTokenInstruction(requester, collateralWeight, collateralMaxStaleness, fee_destination, pyth_product, pyth_price, marginPoolConfig),
    );
    await this.sendTransaction(connection, tx2, [payer]);
  }

  async makeRegisterTokenInstruction(
    requester: PublicKey,
  ): Promise<TransactionInstruction> {
    const [ authority, _ ] = await PublicKey.findProgramAddress([], this.controlProgramId);

    return this.controlInstructions.registerToken({
      accounts: {
        requester,
        authority,
        marginPool: this.address,
        vault: this.vault,
        depositNoteMint: this.deposit_note_mint,
        loanNoteMint: this.loan_note_mint,
        tokenMint: this.token_mint,
        tokenMetadata: (await PublicKey.findProgramAddress([this.token_mint.toBuffer()], this.metadataProgramId))[0],
        depositNoteMetadata: (await PublicKey.findProgramAddress([this.deposit_note_mint.toBuffer()], this.metadataProgramId))[0],
        loanNoteMetadata: (await PublicKey.findProgramAddress([this.loan_note_mint.toBuffer()], this.metadataProgramId))[0],
        marginPoolProgram: this.marginPoolProgramId,
        metadataProgram: this.metadataProgramId,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      },
    });
  }

  async makeConfigureTokenInstruction(
    requester: PublicKey,
    collateralWeight: number,
    collateralMaxStaleness: BN,
    fee_destination: PublicKey,
    pyth_product: PublicKey,
    pyth_price: PublicKey,
    marginPoolConfig,
  ): Promise<TransactionInstruction> {
    const metadata = {
      tokenKind: { collateral: {} },
      collateralWeight: collateralWeight,
      collateralMaxStaleness: collateralMaxStaleness,
    } as TokenMetadataParams;
    const poolParam = {
      feeDestination: fee_destination,
    } as MarginPoolParams;
    const poolConfig = {
      flags: marginPoolConfig.flags,
      utilizationRate1: marginPoolConfig.utilization_rate_1,
      utilizationRate2: marginPoolConfig.utilization_rate_2,
      borrowRate0: marginPoolConfig.borrow_rate_0,
      borrowRate1: marginPoolConfig.borrow_rate_1,
      borrowRate2: marginPoolConfig.borrow_rate_2,
      borrowRate3: marginPoolConfig.borrow_rate_3,
      managementFeeRate: marginPoolConfig.management_fee_rate,
      managementFeeCollectThreshold: marginPoolConfig.management_fee_collect_threshold,
    } as MarginPoolConfig;

    const [ authority, _ ] = await PublicKey.findProgramAddress([], this.controlProgramId);

    return this.controlInstructions.configureToken(
      { tokenKind: metadata.tokenKind as never, collateralWeight: metadata.collateralWeight, collateralMaxStaleness: metadata.collateralMaxStaleness },
      poolParam,
      poolConfig,
      {
        accounts: {
          requester,
          authority,
          tokenMint: this.token_mint,
          marginPool: this.address,
          tokenMetadata: (await PublicKey.findProgramAddress([this.token_mint.toBuffer()], this.metadataProgramId))[0],
          depositMetadata: (await PublicKey.findProgramAddress([this.deposit_note_mint.toBuffer()], this.metadataProgramId))[0],
          pythProduct: pyth_product,
          pythPrice: pyth_price,
          marginPoolProgram: this.marginPoolProgramId,
          metadataProgram: this.metadataProgramId,
        },
      }
    );
  }

  /// Instruction to deposit tokens into the pool in exchange for deposit notes
  ///
  /// # Params
  ///
  /// `depositor` - The authority for the source tokens
  /// `source` - The token account that has the tokens to be deposited
  /// `destination` - The token account to send notes representing the deposit
  /// `amount` - The amount of tokens to be deposited
  async deposit(
    connection: Connection,
    marginAccount: MarginAccount,
    source: PublicKey,
    amount: number,
  ) {
    await marginAccount.refresh(connection);
    const position = await marginAccount.getOrCreatePosition(connection, this.deposit_note_mint);
    assert(position);

    const tx = new Transaction();
    tx.add(
      await this.makeDepositInstruction(marginAccount.address, source, position.address, new BN(amount)),
      await marginAccount.makeUpdatePositionBalanceInstruction(position.address),
    );
    return await this.sendTransaction(connection, tx, [marginAccount.owner]);
  }

  async makeDepositInstruction(
    marginAccount: PublicKey,
    source: PublicKey,
    destination: PublicKey,
    amount: BN,
  ): Promise<TransactionInstruction> {
    return this.marginPoolInstructions.deposit(amount, {
      accounts: {
        marginPool: this.address,
        vault: this.vault,
        depositNoteMint: this.deposit_note_mint,
        depositor: marginAccount,
        source,
        destination,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
    });
  }

  // async refreshAllPoolPositions(
  //   connection: Connection,
  //   marginAccount: MarginAccount,
  // ) {
  //   // we need to get the positions
  //   //
  // }

  async refreshPosition(
    connection: Connection,
    marginAccount: MarginAccount,
  ) {
    const token_metadata = await marginAccount.getTokenMetadata(connection, this.token_mint);

    await this.sendTransaction(
      connection,
      new Transaction()
        .add(this.makeAdapterInvokeInstruction(marginAccount.owner.publicKey, marginAccount.address, this.marginPoolProgramId, this.marginPoolAdapterMetadata, await this.makeMarginRefreshPositionInstruction(marginAccount.address, token_metadata.pythPrice))),
      [marginAccount.owner]
    );
  }

  async marginBorrow(
    connection: Connection,
    marginAccount: MarginAccount,
    amount: BN,
  ) {
    await marginAccount.refresh(connection);
    const deposit_position = await marginAccount.getOrCreatePosition(connection, this.deposit_note_mint);
    assert(deposit_position);

    const loan_position = await marginAccount.getOrCreatePosition(connection, this.loan_note_mint);
    assert(loan_position);

    const token_metadata = await marginAccount.getTokenMetadata(connection, this.token_mint);

    const data = Buffer.from(
      Uint8Array.of(0, ...new BN(500000).toArray("le", 4))
    );
    const additionalComputeBudgetInstruction = new TransactionInstruction({
      keys: [],
      programId: new PublicKey("ComputeBudget111111111111111111111111111111"),
      data,
    });
    const tx = new Transaction()
      .add(additionalComputeBudgetInstruction)
      .add(this.makeAdapterInvokeInstruction(marginAccount.owner.publicKey, marginAccount.address, this.marginPoolProgramId, this.marginPoolAdapterMetadata, await this.makeMarginRefreshPositionInstruction(marginAccount.address, token_metadata.pythPrice)))
      .add(this.makeAdapterInvokeInstruction(marginAccount.owner.publicKey, marginAccount.address, this.marginPoolProgramId, this.marginPoolAdapterMetadata, await this.makeMarginBorrowInstruction(marginAccount.address, deposit_position.address, loan_position.address, amount)));
    await this.sendTransaction(connection, tx, [marginAccount.owner]);
  }

  async makeMarginRefreshPositionInstruction(
    marginAccount: PublicKey,
    tokenPriceOracle: PublicKey,
  ): Promise<TransactionInstruction> {
    assert(marginAccount);
    assert(tokenPriceOracle);
    return this.marginPoolInstructions.marginRefreshPosition({
      accounts: {
        marginAccount,
        marginPool: this.address,
        tokenPriceOracle,
      },
    });
  }

  /// Instruction to borrow tokens using a margin account
  ///
  /// # Params
  ///
  /// `margin_scratch` - The scratch account for the margin system
  /// `margin_account` - The account being borrowed against
  /// `deposit_account` - The account to receive the notes for the borrowed tokens
  /// `loan_account` - The account to receive the notes representing the debt
  /// `amount` - The amount of tokens to be borrowed
  async makeMarginBorrowInstruction(
    marginAccount: PublicKey,
    deposit_account: PublicKey,
    loan_account: PublicKey,
    amount: BN,
  ): Promise<TransactionInstruction> {
    assert(marginAccount);
    assert(deposit_account);
    assert(loan_account);
    return this.marginPoolInstructions.marginBorrow(amount, {
      accounts: {
        marginAccount,
        marginPool: this.address,
        loanNoteMint: this.loan_note_mint,
        depositNoteMint: this.deposit_note_mint,
        loanAccount: loan_account,
        depositAccount: deposit_account,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
    });
  }

  /// Instruction to repay tokens owed by a margin account
  ///
  /// # Params
  ///
  /// `margin_scratch` - The scratch account for the margin system
  /// `margin_account` - The account with the loan to be repaid
  /// `deposit_account` - The account with notes to repay the loan
  /// `loan_account` - The account with the loan debt to be reduced
  /// `amount` - The amount to be repaid
  async marginRepay(
    connection: Connection,
    marginAccount: MarginAccount,
    amount: BN,
  ) {
    await marginAccount.refresh(connection);
    const deposit_position = await marginAccount.getOrCreatePosition(connection, this.deposit_note_mint);
    assert(deposit_position);

    const loan_position = await marginAccount.getOrCreatePosition(connection, this.loan_note_mint);
    assert(loan_position);

    const token_metadata = await marginAccount.getTokenMetadata(connection, this.token_mint);

    const tx = new Transaction();
    tx.add(this.makeAdapterInvokeInstruction(marginAccount.owner.publicKey, marginAccount.address, this.marginPoolProgramId, this.marginPoolAdapterMetadata, await this.makeMarginRepayInstruction(marginAccount.address, deposit_position.address, loan_position.address, Amount.notes(amount))));

    await this.sendTransaction(connection, tx, [marginAccount.owner]);
  }

  async makeMarginRepayInstruction(
    marginAccount: PublicKey,
    deposit_account: PublicKey,
    loan_account: PublicKey,
    amount: Amount,
  ): Promise<TransactionInstruction> {
    return this.marginPoolInstructions.marginRepay(amount.toRpcArg(), {
      accounts: {
        marginAccount: marginAccount,
        marginPool: this.address,
        loanNoteMint: this.loan_note_mint,
        depositNoteMint: this.deposit_note_mint,
        loanAccount: loan_account,
        depositAccount: deposit_account,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
    });
  }

  /// Instruction to withdraw tokens from the pool in exchange for deposit notes
  /// (owned by a margin account)
  ///
  /// # Params
  ///
  /// `margin_scratch` - The scratch account for the margin system
  /// `margin_account` - The margin account with the deposit to be withdrawn
  /// `source` - The token account that has the deposit notes to be exchanged
  /// `destination` - The token account to send the withdrawn deposit
  /// `amount` - The amount of the deposit
  async marginWithdraw(
    connection: Connection,
    marginAccount: MarginAccount,
    destination: PublicKey,
    amount: BN,
  ) {
    const depositPosition = await marginAccount.getOrCreatePosition(connection, this.deposit_note_mint);
    assert(depositPosition);

    const token_metadata = await marginAccount.getTokenMetadata(connection, this.token_mint);

    const tx = new Transaction();
    tx.add(this.makeAdapterInvokeInstruction(marginAccount.owner.publicKey, marginAccount.address, this.marginPoolProgramId, this.marginPoolAdapterMetadata, await this.makeMarginWithdrawInstruction(marginAccount.address, depositPosition.address, destination, Amount.tokens(amount))));

    await this.sendTransaction(connection, tx, [marginAccount.owner]);
  }

  async makeMarginWithdrawInstruction(
    marginAccount: PublicKey,
    source: PublicKey,
    destination: PublicKey,
    amount: Amount,
  ): Promise<TransactionInstruction> {
    return this.marginPoolInstructions.marginWithdraw(amount.toRpcArg(), {
      accounts: {
        marginAccount: marginAccount,
        marginPool: this.address,
        vault: this.vault,
        depositNoteMint: this.deposit_note_mint,
        source,
        destination,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
    });
  }

  makeAdapterInvokeInstruction(
    owner: PublicKey,
    marginAccount: PublicKey,
    adapterProgram: PublicKey,
    adapterMetadata: PublicKey,
    adapterInstruction: TransactionInstruction,
  ): TransactionInstruction {
    return this.marginInstructions.adapterInvoke(
      adapterInstruction.keys.slice(1).map((accountMeta) => { return { isSigner: false, isWritable: accountMeta.isWritable }; }),
      adapterInstruction.data,
      {
        accounts: {
          owner,
          marginAccount,
          adapterProgram,
          adapterMetadata,
        },
        remainingAccounts: adapterInstruction.keys.slice(1).map((accountMeta) => { return { pubkey: accountMeta.pubkey, isSigner: false, isWritable: accountMeta.isWritable }; }),
      }
    );
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

}
