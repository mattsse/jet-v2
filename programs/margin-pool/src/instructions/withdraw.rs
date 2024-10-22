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
use anchor_spl::token::{self, Burn, Token, Transfer};

use crate::state::*;
use crate::{Amount, ErrorCode};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// The pool to withdraw from
    #[account(mut,
              has_one = vault,
              has_one = deposit_note_mint)]
    pub margin_pool: Account<'info, MarginPool>,

    /// The vault for the pool, where tokens are held
    /// CHECK:
    #[account(mut)]
    pub vault: AccountInfo<'info>,

    /// The mint for the deposit notes
    /// CHECK:
    #[account(mut)]
    pub deposit_note_mint: UncheckedAccount<'info>,

    /// The address with authority to withdraw the deposit
    pub depositor: Signer<'info>,

    /// The source of the deposit notes to be redeemed
    /// CHECK:
    #[account(mut)]
    pub source: UncheckedAccount<'info>,

    /// The destination of the tokens withdrawn
    /// CHECK:
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

impl<'info> Withdraw<'info> {
    fn transfer_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                to: self.destination.to_account_info(),
                from: self.vault.to_account_info(),
                authority: self.margin_pool.to_account_info(),
            },
        )
    }

    fn burn_note_context(&self) -> CpiContext<'_, '_, '_, 'info, Burn<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Burn {
                to: self.source.to_account_info(),
                mint: self.deposit_note_mint.to_account_info(),
                authority: self.depositor.to_account_info(),
            },
        )
    }
}

pub fn withdraw_handler(ctx: Context<Withdraw>, amount: Amount) -> Result<()> {
    let pool = &mut ctx.accounts.margin_pool;
    let clock = Clock::get()?;

    // Make sure interest accrual is up-to-date
    if !pool.accrue_interest(clock.unix_timestamp) {
        msg!("interest accrual is too far behind");
        return Err(ErrorCode::InterestAccrualBehind.into());
    }

    let withdraw_rounding = RoundingDirection::direction(PoolAction::Withdraw, amount.kind);
    let withdraw_amount = pool.convert_deposit_amount(amount, withdraw_rounding)?;
    pool.withdraw(&withdraw_amount)?;

    let pool = &ctx.accounts.margin_pool;
    let signer = [&pool.signer_seeds()?[..]];

    token::transfer(
        ctx.accounts.transfer_context().with_signer(&signer),
        withdraw_amount.tokens,
    )?;
    token::burn(
        ctx.accounts.burn_note_context().with_signer(&signer),
        withdraw_amount.notes,
    )?;

    Ok(())
}
