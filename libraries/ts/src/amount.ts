/*
 * Copyright (C) 2022 JET PROTOCOL HOLDINGS, LLC.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as anchor from "@project-serum/anchor"

type AmountKindTokens = { tokens: Record<string, never> }
type AmountKindNotes = { notes: Record<string, never> }

export type AmountKind = AmountKindTokens | AmountKindNotes

/**
 * TODO:
 * @export
 * @class Amount
 */
export class Amount {
  /**
   * Creates an instance of Amount.
   * @param {AmountKind} kind
   * @param {anchor.BN} value
   * @memberof Amount
   */
  constructor(public kind: AmountKind, public value: anchor.BN) {}

  /**
   * TODO:
   * @static
   * @param {(number | anchor.BN)} amount
   * @returns {Amount}
   * @memberof Amount
   */
  static tokens(amount: number | anchor.BN): Amount {
    return new Amount({ tokens: {} }, new anchor.BN(amount))
  }

  /**
   * TODO:
   * @static
   * @param {(number | anchor.BN)} amount
   * @returns {Amount}
   * @memberof Amount
   */
  static notes(amount: number | anchor.BN): Amount {
    return new Amount({ notes: {} }, new anchor.BN(amount))
  }

  /**
   * Converts the class instance into an object that can
   * be used as an argument for Solana instruction calls.
   * @returns {{ units: never; value: anchor.BN }}
   * @memberof Amount
   */
  toRpcArg(): { kind: never; value: anchor.BN } {
    return {
      kind: this.kind as never,
      value: this.value
    }
  }
}
