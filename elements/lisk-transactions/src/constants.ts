/*
 * Copyright © 2019 Lisk Foundation
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Unless otherwise agreed in a custom licensing agreement with the Lisk Foundation,
 * no part of this software, including this file, may be copied, modified,
 * propagated, or distributed except according to the terms contained in the
 * LICENSE file.
 *
 * Removal or modification of this copyright notice is prohibited.
 *
 */
/* tslint:disable:no-magic-numbers */
/**
 * #### Description
 * Number to use when converting between the smallest possible denomination and 1 LSK.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.FIXED_POINT;
 * ```
 */
export const FIXED_POINT = 10 ** 8;
/**
 * #### Description
 * Fee required for a transfer (type 8) transaction.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.TRANSFER_FEE;
 * ```
 */
export const TRANSFER_FEE = FIXED_POINT * 0.1;
export const IN_TRANSFER_FEE = FIXED_POINT * 0.1;
export const OUT_TRANSFER_FEE = FIXED_POINT * 0.1;
/**
 * #### Description
 * Fee required for a register second passphrase (type 9) transaction.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.SIGNATURE_FEE;
 * ```
 */
export const SIGNATURE_FEE = FIXED_POINT * 5;
/**
 * #### Description
 * Fee required for a register delegate (type 10) transaction.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.DELEGATE_FEE;
 * ```
 */
export const DELEGATE_FEE = FIXED_POINT * 25;
/**
 * #### Description
 * Fee required for a cast votes (type 11) transaction.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.VOTE_FEE;
 * ```
 */
export const VOTE_FEE = FIXED_POINT * 1;
/**
 * #### Description
 * Fee required per group member (plus one) for a registered multisignature account (type 12) transaction.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.MULTISIGNATURE_FEE;
 * ```
 */
export const MULTISIGNATURE_FEE = FIXED_POINT * 5;
export const MULTISIGNATURE_MAX_LIFETIME = 72;
export const MULTISIGNATURE_MIN_LIFETIME = 1;
export const MULTISIGNATURE_MAX_KEYSGROUP = 15;
export const MULTISIGNATURE_MIN_KEYSGROUP = 1;
export const DAPP_FEE = FIXED_POINT * 25;
export const USERNAME_MAX_LENGTH = 20;

export const BYTESIZES = {
	TYPE: 1,
	TIMESTAMP: 4,
	MULTISIGNATURE_PUBLICKEY: 32,
	RECIPIENT_ID: 8,
	AMOUNT: 8,
	SIGNATURE_TRANSACTION: 64,
	SECOND_SIGNATURE_TRANSACTION: 64,
	DATA: 64,
};
/**
 * #### Description
 * Date from which timestamps are calculated.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.EPOCH_TIME;
 * ```
 */
export const EPOCH_TIME = new Date(Date.UTC(2016, 4, 24, 17, 0, 0, 0));
/**
 * #### Description
 * Epoch time in milliseconds since Unix epoch.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.EPOCH_TIME_MILLISECONDS;
 * ```
 */
export const EPOCH_TIME_MILLISECONDS = EPOCH_TIME.getTime();
const MS_FACTOR = 1000;
/**
 * #### Description
 * Epoch time in seconds since Unix epoch.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.EPOCH_TIME_SECONDS;
 * ```
 */
export const EPOCH_TIME_SECONDS = Math.floor(EPOCH_TIME.getTime() / MS_FACTOR);

// Largest possible number which can be stored in eight bytes.
// Derived from bignum.fromBuffer(Buffer.from(new Array(8).fill(255))).
const MAX_EIGHT_BYTE_NUMBER = '18446744073709551615';
/**
 * #### Description
 * Maximum valid number which can form an address when suffixed with an 'L'.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.MAX_ADDRESS_NUMBER;
 * ```
 */
export const MAX_ADDRESS_NUMBER = MAX_EIGHT_BYTE_NUMBER;
/**
 * #### Description
 * Maximum valid number for transaction IDs.
 *
 * #### Example
 * ```
 * import * as transactions from '@liskhq/lisk-transactions';
 *
 * transactions.constants.MAX_TRANSACTION_ID;
 * ```
 */
export const MAX_TRANSACTION_ID = MAX_EIGHT_BYTE_NUMBER;
// Largest possible amount. Maximum value for PostgreSQL bigint.
export const MAX_TRANSACTION_AMOUNT = '9223372036854775807';
export const UNCONFIRMED_TRANSACTION_TIMEOUT = 10800;
export const UNCONFIRMED_MULTISIG_TRANSACTION_TIMEOUT = 10800 * 8;
export const MAX_MULTISIG_SIGNATURES = 15;
export const MAX_PUBLIC_KEY_LENGTH = 32;
export const MAX_TRANSFER_ASSET_DATA_LENGTH = 64;
export const NETWORK_IDENTIFIER_LENGTH = 32;
