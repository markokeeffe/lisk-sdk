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

import { BlockHeader, Chain } from '@liskhq/lisk-chain';
import { APIContext } from '../../state_machine/types';
import { BFTAPI, ValidatorAPI } from '../types';
import {
	AggregateCommit,
	Certificate,
	CommitPoolConfig,
	SingleCommit,
	ValidatorInfo,
} from './types';
import {
	computeCertificateFromBlockHeader,
	verifyAggregateCertificateSignature,
	getSortedWeightsAndValidatorKeys,
} from './utils';

export class CommitPool {
	private readonly _nonGossipedCommits: Map<number, SingleCommit[]> = new Map<
		number,
		SingleCommit[]
	>();
	private readonly _gossipedCommits: Map<number, SingleCommit[]> = new Map<
		number,
		SingleCommit[]
	>();
	private readonly _blockTime: number;
	private readonly _bftAPI: BFTAPI;
	private readonly _validatorsAPI: ValidatorAPI;
	private readonly _chain: Chain;

	public constructor(config: CommitPoolConfig) {
		this._blockTime = config.blockTime;
		this._bftAPI = config.bftAPI;
		this._validatorsAPI = config.validatorsAPI;
		this._chain = config.chain;
		// eslint-disable-next-line no-console
		console.log(
			this._nonGossipedCommits.size,
			this._gossipedCommits.size,
			this._blockTime,
			this._bftAPI,
			this._validatorsAPI,
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	public async job(): Promise<void> {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	public addCommit(_commit: SingleCommit, _height: number): void {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	public validateCommit(): boolean {
		return true;
	}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	public getCommitsByHeight(_height: number): SingleCommit[] {
		return [];
	}

	public createSingleCommit(
		_blockHeader: BlockHeader,
		_validatorInfo: ValidatorInfo,
		_networkIdentifier: Buffer,
		// eslint-disable-next-line @typescript-eslint/no-empty-function
	): SingleCommit {
		return {} as SingleCommit;
	}

	public async verifyAggregateCommit(
		apiContext: APIContext,
		aggregateCommit: AggregateCommit,
	): Promise<boolean> {
		const { maxHeightCertified, maxHeightPrecommitted } = await this._bftAPI.getBFTHeights(
			apiContext,
		);

		if (
			aggregateCommit.aggregationBits.length === 0 &&
			aggregateCommit.certificateSignature.length === 0 &&
			aggregateCommit.height === maxHeightCertified
		) {
			return true;
		}

		if (
			aggregateCommit.aggregationBits.length === 0 ||
			aggregateCommit.certificateSignature.length === 0
		) {
			return false;
		}

		if (aggregateCommit.height <= maxHeightCertified) {
			return false;
		}

		if (aggregateCommit.height > maxHeightPrecommitted) {
			return false;
		}

		try {
			const heightNextBFTParameters = await this._bftAPI.getNextHeightBFTParameters(
				apiContext,
				maxHeightCertified + 1,
			);

			if (aggregateCommit.height > heightNextBFTParameters - 1) {
				return false;
			}
		} catch {
			// TODO: Throw if error is not BFTParameterNotFoundError when we use BFT module interface
		}

		const blockHeader = await this._chain.dataAccess.getBlockHeaderByHeight(aggregateCommit.height);
		const certificate: Certificate = {
			...computeCertificateFromBlockHeader(blockHeader),
			aggregationBits: aggregateCommit.aggregationBits,
			signature: aggregateCommit.certificateSignature,
		};
		const { networkIdentifier } = this._chain;
		const bftParams = await this._bftAPI.getBFTParameters(apiContext, aggregateCommit.height);
		const threshold = bftParams.certificateThreshold;

		const validatorKeysWithWeights = [];
		for (const validator of bftParams.validators) {
			const validatorAccount = await this._validatorsAPI.getValidatorAccount(
				apiContext,
				validator.address,
			);
			validatorKeysWithWeights.push({
				weight: validator.bftWeight,
				blsKey: validatorAccount.blsKey,
			});
		}
		const { weights, validatorKeys } = getSortedWeightsAndValidatorKeys(validatorKeysWithWeights);

		return verifyAggregateCertificateSignature(
			validatorKeys,
			weights,
			threshold,
			networkIdentifier,
			certificate,
		);
	}
	// TODO: To be updated in the issue https://github.com/LiskHQ/lisk-sdk/issues/6846
	public getAggregageCommit(): AggregateCommit {
		const singleCommits = this._selectAggregateCommit();

		return this._aggregateSingleCommits((singleCommits as unknown) as SingleCommit[]);
	}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	private _aggregateSingleCommits(_singleCommits: SingleCommit[]): AggregateCommit {
		return {} as AggregateCommit;
	}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	private _selectAggregateCommit(): SingleCommit[] {
		return [];
	}
}
