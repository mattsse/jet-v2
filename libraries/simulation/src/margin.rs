// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Copyright (C) 2022 JET PROTOCOL HOLDINGS, LLC.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

#![allow(unused)]

use std::sync::Arc;

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use anyhow::Error;

use jet_margin::PositionKind;
use jet_margin_sdk::accounts::MarginPoolAccounts;
use jet_margin_sdk::instructions::control::{get_authority_address, TokenConfiguration};
use solana_sdk::instruction::Instruction;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::system_program;
use solana_sdk::{pubkey::Pubkey, transaction::Transaction};

use jet_margin_pool::{Amount, MarginPool, MarginPoolConfig};
use jet_margin_sdk::tx_builder::MarginTxBuilder;
use jet_metadata::{LiquidatorMetadata, MarginAdapterMetadata, TokenKind, TokenMetadata};
use jet_solana_rpc_api::SolanaRpcClient;

use crate::swap::SwapPool;
use crate::{send_and_confirm, tokens::TokenOracle};

/// Information needed to create a new margin pool
pub struct MarginPoolSetupInfo {
    pub token: Pubkey,
    pub fee_destination: Pubkey,
    pub token_kind: TokenKind,
    pub collateral_weight: u16,
    pub oracle: TokenOracle,
    pub config: MarginPoolConfig,
}

/// Utility for making use of the Jet margin system.
pub struct MarginClient {
    rpc: Arc<dyn SolanaRpcClient>,
}

impl MarginClient {
    pub fn new(rpc: Arc<dyn SolanaRpcClient>) -> Self {
        Self { rpc }
    }

    pub async fn user(&self, keypair: &Keypair) -> Result<MarginUser, Error> {
        let tx = MarginTxBuilder::new(
            self.rpc.clone(),
            Some(Keypair::from_bytes(&keypair.to_bytes())?),
            keypair.pubkey(),
            0,
            false,
        );

        Ok(MarginUser {
            tx,
            rpc: self.rpc.clone(),
        })
    }

    pub async fn liquidator(&self, keypair: &Keypair, owner: &Pubkey) -> Result<MarginUser, Error> {
        let tx = MarginTxBuilder::new(
            self.rpc.clone(),
            Some(Keypair::from_bytes(&keypair.to_bytes())?),
            *owner,
            0,
            true,
        );

        Ok(MarginUser {
            tx,
            rpc: self.rpc.clone(),
        })
    }

    /// Find all the margin pools created
    pub async fn find_pools(&self) -> Result<Vec<MarginPool>, Error> {
        self.rpc
            .get_program_accounts(
                &jet_margin_pool::ID,
                Some(std::mem::size_of::<MarginPool>()),
            )
            .await?
            .into_iter()
            .map(|(_, account)| {
                MarginPool::try_deserialize(&mut &account.data[..]).map_err(Error::from)
            })
            .collect()
    }

    pub async fn create_authority(&self) -> Result<(), Error> {
        let ix = jet_margin_sdk::instructions::control::create_authority(self.rpc.payer().pubkey());

        send_and_confirm(&self.rpc, &[ix], &[]).await?;
        Ok(())
    }

    pub async fn register_adapter(&self, adapter: &Pubkey) -> Result<(), Error> {
        let ix = jet_margin_sdk::instructions::control::register_adapter(
            adapter,
            &self.rpc.payer().pubkey(),
            &self.rpc.payer().pubkey(),
        );

        send_and_confirm(&self.rpc, &[ix], &[]).await?;
        Ok(())
    }

    pub async fn configure_token(
        &self,
        token: &Pubkey,
        config: &TokenConfiguration,
    ) -> Result<(), Error> {
        let pool = MarginPoolAccounts::derive_from_token(*token);
        let ix = jet_margin_sdk::instructions::control::configure_token(
            &pool,
            &self.rpc.payer().pubkey(),
            config,
        );

        send_and_confirm(&self.rpc, &[ix], &[]).await?;

        Ok(())
    }

    /// Create a new margin pool for a token
    pub async fn create_pool(&self, setup_info: &MarginPoolSetupInfo) -> Result<(), Error> {
        let pool = MarginPoolAccounts::derive_from_token(setup_info.token);
        let ix = jet_margin_sdk::instructions::control::register_token(
            &pool,
            &self.rpc.payer().pubkey(),
        );

        send_and_confirm(&self.rpc, &[ix], &[]).await?;

        //self.set_position_token_metadata(
        //    jet_margin_pool::ID,
        //    ix_builder.deposit_note_mint,
        //    setup_info.token,
        //    setup_info.token_kind,
        //    setup_info.collateral_weight,
        //)
        //.await?;

        //self.set_position_token_metadata(
        //    jet_margin_pool::ID,
        //    ix_builder.loan_note_mint,
        //    setup_info.token,
        //    TokenKind::Claim,
        //    10_000,
        //)
        //.await?;

        Ok(())
    }

    pub async fn set_liquidator_metadata(&self, liquidator: Pubkey) -> Result<(), Error> {
        let metadata = LiquidatorMetadata { liquidator };

        self.set_metadata(liquidator, &metadata).await
    }

    pub async fn set_adapter_metadata(&self, program: Pubkey) -> Result<(), Error> {
        let metadata = MarginAdapterMetadata {
            adapter_program: program,
        };

        self.set_metadata(program, &metadata).await
    }

    // async fn set_position_token_metadata(
    //     &self,
    //     adapter_program: Pubkey,
    //     position_token_mint: Pubkey,
    //     underlying_token_mint: Pubkey,
    //     token_kind: TokenKind,
    //     collateral_weight: u16,
    // ) -> Result<(), Error> {
    //     let metadata = PositionTokenMetadata {
    //         adapter_program,
    //         position_token_mint,
    //         underlying_token_mint,
    //         token_kind,
    //         collateral_weight,
    //         collateral_max_staleness: 0,
    //     };

    //     self.set_metadata(position_token_mint, &metadata).await?;

    //     Ok(())
    // }

    pub async fn set_token_metadata(
        &self,
        mint: &Pubkey,
        metadata: &TokenMetadata,
    ) -> Result<(), Error> {
        self.set_metadata(*mint, metadata).await
    }

    async fn set_metadata<T: AccountSerialize>(
        &self,
        key: Pubkey,
        metadata: &T,
    ) -> Result<(), Error> {
        let mut data = vec![];
        metadata.try_serialize(&mut data)?;

        // FIXME: support metadata >512 bytes
        data.resize(std::cmp::min(8 + std::mem::size_of::<T>(), 512), 0);

        let (md_address, _) = Pubkey::find_program_address(&[key.as_ref()], &jet_metadata::ID);
        let ix_create = Instruction {
            program_id: jet_metadata::ID,
            data: jet_metadata::instruction::CreateEntry {
                seed: String::new(),
                space: 8 + std::mem::size_of::<T>() as u64,
            }
            .data(),
            accounts: jet_metadata::accounts::CreateEntry {
                authority: get_authority_address(),
                payer: self.rpc.payer().pubkey(),
                key_account: key,
                metadata_account: md_address,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        };
        let ix_set = Instruction {
            program_id: jet_metadata::ID,
            data: jet_metadata::instruction::SetEntry { offset: 0, data }.data(),
            accounts: jet_metadata::accounts::SetEntry {
                authority: get_authority_address(),
                metadata_account: md_address,
            }
            .to_account_metas(None),
        };

        send_and_confirm(&self.rpc, &[ix_create, ix_set], &[]).await?;

        Ok(())
    }
}

pub struct MarginUser {
    tx: MarginTxBuilder,
    rpc: Arc<dyn SolanaRpcClient>,
}

impl MarginUser {
    async fn send_confirm_tx(&self, tx: Transaction) -> Result<(), Error> {
        let _ = self.rpc.send_and_confirm_transaction(&tx).await?;
        Ok(())
    }
}

impl MarginUser {
    pub fn owner(&self) -> &Pubkey {
        self.tx.owner()
    }

    pub fn signer(&self) -> Pubkey {
        self.tx.signer()
    }

    pub fn address(&self) -> &Pubkey {
        self.tx.address()
    }

    pub async fn create_account(&self) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.create_account().await?).await
    }

    /// Close the margin account
    ///
    /// # Error
    ///
    /// Returns an error if the account is not empty, in which case positions
    /// should be closed first.
    pub async fn close_account(&self) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.close_account().await?).await
    }

    pub async fn refresh_pool_position(&self, token_mint: &Pubkey) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.refresh_pool_position(token_mint).await?)
            .await
    }

    pub async fn refresh_all_pool_positions(&self) -> Result<(), Error> {
        futures::future::join_all(
            self.tx
                .refresh_all_pool_positions()
                .await?
                .into_iter()
                .map(|tx| self.send_confirm_tx(tx)),
        )
        .await
        .into_iter()
        .collect()
    }

    pub async fn deposit(&self, mint: &Pubkey, source: &Pubkey, amount: u64) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.deposit(mint, source, amount).await?)
            .await
    }

    pub async fn withdraw(
        &self,
        mint: &Pubkey,
        destination: &Pubkey,
        amount: Amount,
    ) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.withdraw(mint, destination, amount).await?)
            .await
    }

    pub async fn borrow(&self, mint: &Pubkey, amount: u64) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.borrow(mint, amount).await?)
            .await
    }

    pub async fn repay(&self, mint: &Pubkey, amount: Amount) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.repay(mint, amount).await?)
            .await
    }

    /// Swap between two tokens using a swap pool.
    ///
    /// The `source_mint` and `destination_mint` determine the direction of
    /// the swap.
    #[allow(clippy::too_many_arguments)]
    pub async fn swap(
        &self,
        source_mint: &Pubkey,
        destination_mint: &Pubkey,
        transit_source_account: &Pubkey,
        transit_destination_account: &Pubkey,
        swap_pool: &SwapPool,
        amount_in: Amount,
        minimum_amount_out: Amount,
    ) -> Result<(), Error> {
        // Determine the order of token_a and token_b based on direction of swap
        let (source_token, destination_token) = if source_mint == &swap_pool.mint_a {
            (&swap_pool.token_a, &swap_pool.token_b)
        } else {
            (&swap_pool.token_b, &swap_pool.token_a)
        };
        self.send_confirm_tx(
            self.tx
                .swap(
                    source_mint,
                    destination_mint,
                    transit_source_account,
                    transit_destination_account,
                    &swap_pool.pool,
                    &swap_pool.pool_mint,
                    &swap_pool.fee_account,
                    source_token,
                    destination_token,
                    &spl_token_swap::ID,
                    amount_in,
                    minimum_amount_out,
                )
                .await?,
        )
        .await
    }

    pub async fn liquidate_begin(&self) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.liquidate_begin().await?).await
    }

    pub async fn liquidate_end(&self, original_liquidator: Option<Pubkey>) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.liquidate_end(original_liquidator).await?)
            .await
    }

    pub async fn verify_healthy(&self) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.verify_healthy().await?).await
    }

    /// Close a user's empty positions.
    pub async fn close_empty_positions(&self) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.close_empty_positions().await?)
            .await
    }

    /// Close a user's token positions for a specific mint.
    pub async fn close_token_positions(&self, token_mint: &Pubkey) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.close_token_positions(token_mint).await?)
            .await
    }

    /// Close a user's token position for a mint, with the specified and token kind.
    pub async fn close_token_position(
        &self,
        token_mint: &Pubkey,
        kind: PositionKind,
    ) -> Result<(), Error> {
        self.send_confirm_tx(self.tx.close_token_position(token_mint, kind).await?)
            .await
    }
}
