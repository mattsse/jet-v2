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

use std::time::{SystemTime, UNIX_EPOCH};

use anchor_lang::prelude::{Clock, SolanaSysvar};

/// Get the current timestamp in seconds since Unix epoch
///
/// The function returns a [anchor_lang::prelude::Clock] value in the bpf arch,
/// and first checks if there is a [Clock] in other archs, returning the system
/// time if there is no clock (e.g. if not running in a simulator with its clock).
pub fn get_timestamp() -> u64 {
    #[cfg(target_arch = "bpf")]
    {
        Clock::get().unwrap().unix_timestamp as u64
    }
    #[cfg(not(target_arch = "bpf"))]
    {
        // Get the clock in case it's available in a simulation,
        // then fall back to the system clock
        if let Ok(clock) = Clock::get() {
            clock.unix_timestamp as u64
        } else {
            let time = SystemTime::now();
            time.duration_since(UNIX_EPOCH).unwrap().as_secs()
        }
    }
}
