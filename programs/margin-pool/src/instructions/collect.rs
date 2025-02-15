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
use anchor_spl::token::{self, MintTo, Token};

use crate::state::*;

#[derive(Accounts)]
pub struct Collect<'info> {
    /// The pool to be refreshed
    #[account(mut,
              has_one = vault,
              has_one = deposit_note_mint,
              has_one = fee_destination)]
    pub margin_pool: Account<'info, MarginPool>,

    /// The vault for the pool, where tokens are held
    /// CHECK:
    #[account(mut)]
    pub vault: AccountInfo<'info>,

    /// The account to deposit the collected fees
    /// CHECK:
    #[account(mut)]
    pub fee_destination: AccountInfo<'info>,

    /// The mint for the deposit notes
    /// CHECK:
    #[account(mut)]
    pub deposit_note_mint: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
}

impl<'info> Collect<'info> {
    fn mint_note_context(&self) -> CpiContext<'_, '_, '_, 'info, MintTo<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            MintTo {
                mint: self.deposit_note_mint.to_account_info(),
                to: self.fee_destination.to_account_info(),
                authority: self.margin_pool.to_account_info(),
            },
        )
    }
}

pub fn collect_handler(ctx: Context<Collect>) -> Result<()> {
    let pool = &mut ctx.accounts.margin_pool;
    let clock = Clock::get()?;

    if !pool.accrue_interest(clock.unix_timestamp) {
        msg!("could not fully accrue interest");
        return Ok(());
    }

    let fee_notes = pool.collect_accrued_fees();
    let pool = &ctx.accounts.margin_pool;

    token::mint_to(
        ctx.accounts
            .mint_note_context()
            .with_signer(&[&pool.signer_seeds()?]),
        fee_notes,
    )?;

    Ok(())
}
