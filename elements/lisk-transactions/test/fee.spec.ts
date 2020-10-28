/*
 * Copyright © 2020 Lisk Foundation
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

import { getAddressAndPublicKeyFromPassphrase } from '@liskhq/lisk-cryptography';
import * as Fee from '../src/fee';

const validAssetSchema = {
	$id: 'lisk/transfer-transaction',
	title: 'Transfer transaction asset',
	type: 'object',
	required: ['amount', 'recipientAddress', 'data'],
	properties: {
		amount: {
			dataType: 'uint64',
			fieldNumber: 1,
		},
		recipientAddress: {
			dataType: 'bytes',
			fieldNumber: 2,
			minLength: 20,
			maxLength: 20,
		},
		data: {
			dataType: 'string',
			fieldNumber: 3,
			minLength: 0,
			maxLength: 64,
		},
	},
};
const passphrase1 = 'trim elegant oven term access apple obtain error grain excite lawn neck';
const { publicKey: publicKey1 } = getAddressAndPublicKeyFromPassphrase(passphrase1);
const validTransaction = {
	moduleID: 2,
	assetID: 0,
	nonce: BigInt('1'),
	senderPublicKey: publicKey1,
	asset: {
		recipientAddress: Buffer.from('3a971fd02b4a07fc20aad1936d3cb1d263b96e0f', 'hex'),
		amount: BigInt('4008489300000000'),
		data: '',
	},
};
const baseFees = [
	{
		moduleID: 2,
		assetID: 0,
		baseFee: '10000000',
	},
	{
		moduleID: 5,
		assetID: 0,
		baseFee: '1',
	},
	{
		moduleID: 3,
		assetID: 0,
		baseFee: '1',
	},
];

describe('fee', () => {
	beforeEach(() => {
		jest.spyOn(Fee, 'calculateMinFee');
	});

	describe('getMinFee', () => {
		it('should return minimum fee required to send to network', () => {
			// Arrange & Assert
			const minFee = Fee.getMinFee(validAssetSchema, validTransaction);

			expect(minFee).not.toBeUndefined();
			expect(minFee).toMatchSnapshot();
			expect(Fee.calculateMinFee).toHaveBeenCalledTimes(3);

			// Arrange & Assert
			const computedMinFee = Fee.calculateMinFee(validAssetSchema, {
				...validTransaction,
				fee: minFee,
			});
			expect(minFee).toEqual(computedMinFee);
		});

		it('should calculate minimum fee for given minFeePerByte', () => {
			// Arrange & Assert
			const options = { minFeePerByte: 2000, baseFees, numberOfSignatures: 1 };
			const minFee = Fee.getMinFee(validAssetSchema, validTransaction, options);

			expect(minFee).not.toBeUndefined();
			expect(minFee).toMatchSnapshot();
			expect(Fee.calculateMinFee).toHaveBeenCalledTimes(3);

			// Arrange & Assert
			const computedMinFee = Fee.calculateMinFee(
				validAssetSchema,
				{ ...validTransaction, fee: minFee },
				options,
			);
			expect(minFee).toEqual(computedMinFee);
		});

		it('should calculate minimum fee for transaction from multisignature account', () => {
			// Arrange & Assert
			const options = { minFeePerByte: 2000, baseFees, numberOfSignatures: 64 };
			const minFee = Fee.getMinFee(validAssetSchema, validTransaction, options);

			expect(minFee).not.toBeUndefined();
			expect(minFee).toMatchSnapshot();
			expect(Fee.calculateMinFee).toHaveBeenCalledTimes(3);

			// Arrange & Assert
			const computedMinFee = Fee.calculateMinFee(
				validAssetSchema,
				{ ...validTransaction, fee: minFee },
				options,
			);
			expect(minFee).toEqual(computedMinFee);
		});

		it('should calculate minimum fee for delegate registration transaction', () => {
			// Arrange & Assert
			const delegateRegisterTransaction = {
				...validTransaction,
				moduleID: 5,
				assetID: 0,
				asset: { username: 'delegate1' },
			};
			const options = { minFeePerByte: 1000, baseFees, numberOfSignatures: 1 };
			const delegateRegisterAssetSchema = {
				$id: 'lisk/dpos/register',
				type: 'object',
				required: ['username'],
				properties: {
					username: {
						dataType: 'string',
						fieldNumber: 1,
						minLength: 1,
						maxLength: 20,
					},
				},
			};
			const minFee = Fee.getMinFee(
				delegateRegisterAssetSchema,
				delegateRegisterTransaction,
				options,
			);

			expect(minFee).not.toBeUndefined();
			expect(minFee).toMatchSnapshot();
			expect(Fee.calculateMinFee).toHaveBeenCalledTimes(3);

			// Arrange & Assert
			const computedMinFee = Fee.calculateMinFee(
				delegateRegisterAssetSchema,
				{ ...delegateRegisterTransaction, fee: minFee },
				options,
			);
			expect(minFee).toEqual(computedMinFee);
		});
	});
});
