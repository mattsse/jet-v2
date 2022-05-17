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

use solana_sdk::pubkey::Pubkey;

pub struct MarginPoolAccounts {
    /// The address of the margin pool
    pub address: Pubkey,

    /// The address of the mint for tokens stored in the pool
    pub token_mint: Pubkey,

    /// The address of the account holding the tokens in the pool
    pub vault: Pubkey,

    /// The address of the mint for deposit notes, which represent user
    /// deposit in the pool
    pub deposit_note_mint: Pubkey,

    /// The address of the mint for loan notes, which represent user borrows
    /// from the pool
    pub loan_note_mint: Pubkey,
}

impl MarginPoolAccounts {
    pub fn derive_from_token(token_mint: Pubkey) -> MarginPoolAccounts {
        let (address, _) =
            Pubkey::find_program_address(&[token_mint.as_ref()], &jet_margin_pool::id());

        let (vault, _) = Pubkey::find_program_address(
            &[address.as_ref(), b"vault".as_ref()],
            &jet_margin_pool::id(),
        );

        let (deposit_note_mint, _) = Pubkey::find_program_address(
            &[address.as_ref(), b"deposit-notes".as_ref()],
            &jet_margin_pool::id(),
        );

        let (loan_note_mint, _) = Pubkey::find_program_address(
            &[address.as_ref(), b"loan-notes".as_ref()],
            &jet_margin_pool::id(),
        );

        Self {
            token_mint,
            address,
            vault,
            deposit_note_mint,
            loan_note_mint,
        }
    }
}
