/*
 * Copyright © 2021 Lisk Foundation
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
 */

import { BlockHeader } from '@liskhq/lisk-chain';
import { codec } from '@liskhq/lisk-codec';
import { verifyWeightedAggSig } from '@liskhq/lisk-cryptography';
import { MESSAGE_TAG_CERTIFICATE } from './constants';
import { certificateSchema } from './schema';
import { Certificate } from './types';

export const computeCertificateFromBlockHeader = (blockHeader: BlockHeader): Certificate => {
	if (!blockHeader.stateRoot) {
		throw new Error("'stateRoot' is not defined.");
	}

	if (!blockHeader.validatorsHash) {
		throw new Error("'validatorsHash' is not defined.");
	}

	return {
		blockID: blockHeader.id,
		height: blockHeader.height,
		stateRoot: blockHeader.stateRoot,
		timestamp: blockHeader.timestamp,
		validatorsHash: blockHeader.validatorsHash,
	};
};

// TODO: https://github.com/LiskHQ/lisk-sdk/issues/6840
export const signCertificate = (
	_sk: Buffer,
	_networkIdentifier: Buffer,
	_blockHeader: BlockHeader,
	// eslint-disable-next-line @typescript-eslint/no-empty-function
): Buffer => Buffer.from('');

// TODO: https://github.com/LiskHQ/lisk-sdk/issues/6841
export const verifySingleCertificateSignature = (
	_pk: Buffer,
	_signature: Buffer,
	_networkIdentifier: Buffer,
	_certificate: Certificate,
	// eslint-disable-next-line @typescript-eslint/no-empty-function
): boolean => true;

export const verifyAggregateCertificateSignature = (
	keysList: Buffer[],
	weights: number[] | bigint[],
	threshold: number | bigint,
	networkIdentifier: Buffer,
	certificate: Certificate,
): boolean => {
	if (!certificate.aggregationBits || !certificate.signature) {
		return false;
	}

	const { aggregationBits, signature } = certificate;
	const message = codec.encode(certificateSchema, {
		blockID: certificate.blockID,
		height: certificate.height,
		timestamp: certificate.timestamp,
		stateRoot: certificate.stateRoot,
		validatorsHash: certificate.validatorsHash,
	});

	return verifyWeightedAggSig(
		keysList,
		aggregationBits,
		signature,
		MESSAGE_TAG_CERTIFICATE,
		networkIdentifier,
		message,
		weights,
		threshold,
	);
};

export const getSortedWeightsAndValidatorKeys = (
	validatorKeysWithWeightsParam: {
		weight: bigint;
		blsKey: Buffer;
	}[],
) => {
	const validatorKeysWithWeights = validatorKeysWithWeightsParam.map(o => ({ ...o }));
	validatorKeysWithWeights.sort((a, b) => a.blsKey.compare(b.blsKey));
	const weights = validatorKeysWithWeights.map(item => item.weight);
	const validatorKeys = validatorKeysWithWeights.map(item => item.blsKey);

	return { weights, validatorKeys };
};
