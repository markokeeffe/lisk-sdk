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

import { BlockHeader as ChainBlockHeader } from '@liskhq/lisk-chain';
import { BIG_ENDIAN, hash, intToBuffer } from '@liskhq/lisk-cryptography';
import { codec } from '@liskhq/lisk-codec';
import { BaseAPI } from '../base_api';
import { APIContext, BlockHeader, ImmutableAPIContext } from '../../node/state_machine';
import {
	areDistinctHeadersContradicting,
	sortValidatorsByAddress,
	sortValidatorsByBLSKey,
} from './utils';
import { getBFTParameters } from './bft_params';
import {
	EMPTY_KEY,
	MAX_UINT32,
	STORE_PREFIX_BFT_PARAMETERS,
	STORE_PREFIX_BFT_VOTES,
} from './constants';
import {
	bftVotesSchema,
	BFTVotes,
	BFTParameters,
	ValidatorsHashInfo,
	ValidatorsHashInput,
	validatorsHashInputSchema,
	bftParametersSchema,
	BFTVotesActiveValidatorsVoteInfo,
} from './schemas';
import { BFTHeights, Validator, ValidatorsAPI } from './types';
import { BFTParameterNotFoundError } from './errors';

export interface BlockHeaderAsset {
	maxHeightPrevoted: number;
	maxHeightPreviouslyForged: number;
}

export class BFTAPI extends BaseAPI {
	private _validatorsAPI!: ValidatorsAPI;
	private _batchSize!: number;

	public addDependencies(validatorsAPI: ValidatorsAPI): void {
		this._validatorsAPI = validatorsAPI;
	}

	public init(batchSize: number) {
		this._batchSize = batchSize;
	}

	public areHeadersContradicting(
		bftHeader1: ChainBlockHeader,
		bftHeader2: ChainBlockHeader,
	): boolean {
		if (bftHeader1.id.equals(bftHeader2.id)) {
			return false;
		}
		return areDistinctHeadersContradicting(bftHeader1, bftHeader2);
	}

	public async isHeaderContradictingChain(
		context: ImmutableAPIContext,
		header: BlockHeader,
	): Promise<boolean> {
		const votesStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_VOTES);
		const bftVotes = await votesStore.getWithSchema<BFTVotes>(EMPTY_KEY, bftVotesSchema);
		for (const bftBlock of bftVotes.blockBFTInfos) {
			if (bftBlock.generatorAddress.equals(header.generatorAddress)) {
				return areDistinctHeadersContradicting(bftBlock, header);
			}
		}
		return false;
	}

	public async existBFTParameters(context: ImmutableAPIContext, height: number): Promise<boolean> {
		const paramsStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_PARAMETERS);
		return paramsStore.has(intToBuffer(height, 4, BIG_ENDIAN));
	}

	public async getBFTParameters(
		context: ImmutableAPIContext,
		height: number,
	): Promise<BFTParameters> {
		const paramsStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_PARAMETERS);
		return getBFTParameters(paramsStore, height);
	}

	public async getBFTHeights(context: ImmutableAPIContext): Promise<BFTHeights> {
		const votesStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_VOTES);
		const bftVotes = await votesStore.getWithSchema<BFTVotes>(EMPTY_KEY, bftVotesSchema);
		return {
			maxHeightPrevoted: bftVotes.maxHeightPrevoted,
			maxHeightPrecommitted: bftVotes.maxHeightPrecommitted,
			maxHeightCertified: bftVotes.maxHeightCertified,
		};
	}

	public async impliesMaximalPrevotes(
		context: ImmutableAPIContext,
		header: BlockHeader,
	): Promise<boolean> {
		const votesStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_VOTES);
		const bftVotes = await votesStore.getWithSchema<BFTVotes>(EMPTY_KEY, bftVotesSchema);
		const [lastHeader] = bftVotes.blockBFTInfos;
		if (header.height !== lastHeader.height + 1) {
			return false;
		}
		const previousHeight = header.maxHeightGenerated;

		// the block does not imply any prevotes
		if (previousHeight >= header.height) {
			return false;
		}

		// there is no block info stored for previousHeight and header implies the maximal number of prevotes
		const offset = lastHeader.height - previousHeight;
		if (offset >= bftVotes.blockBFTInfos.length) {
			return true;
		}
		// block at previousHeight is generated by a different delegate and header doesn't
		// imply maximal number of prevotes
		if (!bftVotes.blockBFTInfos[offset].generatorAddress.equals(header.generatorAddress)) {
			return false;
		}
		return true;
	}

	public async getNextHeightBFTParameters(
		context: ImmutableAPIContext,
		height: number,
	): Promise<number> {
		const paramsStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_PARAMETERS);
		const start = intToBuffer(height + 1, 4, BIG_ENDIAN);
		const end = intToBuffer(MAX_UINT32, 4, BIG_ENDIAN);
		const results = await paramsStore.iterate({
			limit: 1,
			start,
			end,
		});
		if (results.length !== 1) {
			throw new BFTParameterNotFoundError();
		}
		const [result] = results;
		return result.key.readUInt32BE(0);
	}

	public async setBFTParameters(
		context: APIContext,
		precommitThreshold: bigint,
		certificateThreshold: bigint,
		validators: Validator[],
	): Promise<void> {
		if (validators.length > this._batchSize) {
			throw new Error(
				`Invalid validators size. The number of validators can be at most the batch size ${this._batchSize}.`,
			);
		}
		let aggregateBFTWeight = BigInt(0);
		for (const validator of validators) {
			if (validator.bftWeight <= 0) {
				throw new Error('Invalid BFT weight. BFT weight must be a positive integer.');
			}
			aggregateBFTWeight += validator.bftWeight;
		}
		if (
			aggregateBFTWeight / BigInt(3) + BigInt(1) > precommitThreshold ||
			precommitThreshold > aggregateBFTWeight
		) {
			throw new Error('Invalid precommitThreshold input.');
		}
		if (
			aggregateBFTWeight / BigInt(3) + BigInt(1) > certificateThreshold ||
			certificateThreshold > aggregateBFTWeight
		) {
			throw new Error('Invalid certificateThreshold input.');
		}
		const validatorsHash = await this._computeValidatorsHash(
			context,
			validators,
			certificateThreshold,
		);

		sortValidatorsByAddress(validators);

		const bftParams: BFTParameters = {
			prevoteThreshold: (BigInt(2) * aggregateBFTWeight) / BigInt(3) + BigInt(1),
			precommitThreshold,
			certificateThreshold,
			validators,
			validatorsHash,
		};

		const votesStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_VOTES);
		const paramsStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_PARAMETERS);
		const bftVotes = await votesStore.getWithSchema<BFTVotes>(EMPTY_KEY, bftVotesSchema);
		const nextHeight =
			bftVotes.blockBFTInfos.length > 0
				? bftVotes.blockBFTInfos[0].height + 1
				: // TODO: check with research team
				  bftVotes.maxHeightPrevoted;

		const nextHeightBytes = intToBuffer(nextHeight, 4, BIG_ENDIAN);
		await paramsStore.setWithSchema(nextHeightBytes, bftParams, bftParametersSchema);

		const nextActiveValidators: BFTVotesActiveValidatorsVoteInfo[] = [];
		for (const validator of validators) {
			const existingValidator = bftVotes.activeValidatorsVoteInfo.find(v =>
				v.address.equals(validator.address),
			);
			if (existingValidator) {
				nextActiveValidators.push(existingValidator);
				continue;
			}
			nextActiveValidators.push({
				address: validator.address,
				minActiveHeight: nextHeight,
				largestHeightPrecommit: nextHeight - 1,
			});
		}
		sortValidatorsByAddress(nextActiveValidators);
		bftVotes.activeValidatorsVoteInfo = nextActiveValidators;
		await votesStore.setWithSchema(EMPTY_KEY, bftVotes, bftVotesSchema);
	}

	public async getCurrentValidators(context: ImmutableAPIContext): Promise<Validator[]> {
		const votesStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_VOTES);
		const bftVotes = await votesStore.getWithSchema<BFTVotes>(EMPTY_KEY, bftVotesSchema);
		if (bftVotes.blockBFTInfos.length === 0) {
			throw new Error('There are no BFT info stored.');
		}
		const { height: currentHeight } = bftVotes.blockBFTInfos[0];
		const paramsStore = context.getStore(this.moduleID, STORE_PREFIX_BFT_PARAMETERS);
		const params = await getBFTParameters(paramsStore, currentHeight);
		return params.validators;
	}

	private async _computeValidatorsHash(
		context: ImmutableAPIContext,
		validators: Validator[],
		certificateThreshold: bigint,
	): Promise<Buffer> {
		const activeValidators: ValidatorsHashInfo[] = [];
		for (const validator of validators) {
			const { blsKey } = await this._validatorsAPI.getValidatorAccount(context, validator.address);
			activeValidators.push({
				blsKey,
				bftWeight: validator.bftWeight,
			});
		}
		sortValidatorsByBLSKey(activeValidators);
		const input: ValidatorsHashInput = {
			activeValidators,
			certificateThreshold,
		};
		const encodedValidatorsHashInput = codec.encode(validatorsHashInputSchema, input);
		return hash(encodedValidatorsHashInput);
	}
}
