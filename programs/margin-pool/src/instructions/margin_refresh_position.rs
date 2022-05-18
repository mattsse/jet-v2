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
use pyth_client::Price;

use jet_margin::{AdapterResult, MarginAccount, PriceChangeInfo};

use crate::state::*;
use crate::ErrorCode;

#[derive(Accounts)]
pub struct MarginRefreshPosition<'info> {
    /// The margin account being executed on
    #[account(signer)]
    pub margin_account: AccountLoader<'info, MarginAccount>,

    /// The pool to be refreshed
    #[account(has_one = token_price_oracle)]
    pub margin_pool: Account<'info, MarginPool>,

    /// The pyth price account for the pool's token
    /// CHECK:
    pub token_price_oracle: AccountInfo<'info>,
}

pub fn margin_refresh_position_handler(ctx: Context<MarginRefreshPosition>) -> Result<()> {
    let pool = &ctx.accounts.margin_pool;

    // update the oracles with the pyth format
    let token_oracle_data = ctx.accounts.token_price_oracle.try_borrow_data()?;
    let token_oracle = bytemuck::from_bytes::<Price>(&token_oracle_data);

    // verify the price status is actually marked as valid
    if token_oracle.get_current_price_status() != pyth_client::PriceStatus::Trading {
        msg!("the oracle status is not valid");
        return err!(ErrorCode::InvalidPrice);
    }

    let prices = pool.calculate_prices(token_oracle);

    let deposit_price_info = PriceChangeInfo {
        slot: token_oracle.valid_slot,
        exponent: token_oracle.expo,
        value: prices.deposit_note_price,
        confidence: prices.deposit_note_conf,
        twap: prices.deposit_note_twap,
        mint: pool.deposit_note_mint,
    };

    let loan_price_info = PriceChangeInfo {
        slot: token_oracle.valid_slot,
        exponent: token_oracle.expo,
        value: prices.loan_note_price,
        confidence: prices.loan_note_conf,
        twap: prices.loan_note_twap,
        mint: pool.loan_note_mint,
    };

    // Tell the margin program what the current prices are
    jet_margin::write_adapter_result(&AdapterResult::PriceChange(vec![
        deposit_price_info,
        loan_price_info,
    ]))?;

    Ok(())
}
