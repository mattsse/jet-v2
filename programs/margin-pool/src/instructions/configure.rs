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

use anchor_lang::prelude::*;

use crate::state::*;
use jet_metadata::ControlAuthority;

#[derive(Accounts)]
pub struct Configure<'info> {
    /// The pool to be configured
    #[account(mut)]
    pub margin_pool: Account<'info, MarginPool>,

    /// The authority allowed to modify the pool, which must sign
    #[cfg_attr(not(feature = "devnet"), account(signer))]
    pub authority: Account<'info, ControlAuthority>,

    /// CHECK:
    pub pyth_product: AccountInfo<'info>,

    /// CHECK:
    pub pyth_price: AccountInfo<'info>,
}

pub fn configure_handler(
    ctx: Context<Configure>,
    fee_destination: Option<Pubkey>,
    config: Option<MarginPoolConfig>,
) -> Result<()> {
    let pool = &mut ctx.accounts.margin_pool;

    if let Some(new_fee_destination) = fee_destination {
        pool.fee_destination = new_fee_destination;
    }

    if let Some(new_config) = config {
        pool.config = new_config;
    }

    if *ctx.accounts.pyth_price.key != Pubkey::default() {
        // FIXME: validate pyth product

        pool.token_price_oracle = ctx.accounts.pyth_price.key();
        msg!("oracle = {}", &pool.token_price_oracle);
    }

    Ok(())
}
