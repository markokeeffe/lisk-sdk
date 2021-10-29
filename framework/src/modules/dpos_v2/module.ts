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
import { isDeepStrictEqual } from 'util';
import { dataStructures } from '@liskhq/lisk-utils';
import { intToBuffer } from '@liskhq/lisk-cryptography';
import {
	GenesisBlockExecuteContext,
	BlockAfterExecuteContext,
} from '../../node/state_machine/types';
import { BaseModule, ModuleInitArgs } from '../base_module';
import { GenesisData, ModuleConfig, SnapshotData } from './types';
import { ValidatorsAPI } from '../validators';
import { DPoSAPI } from './api';
import { DelegateRegistrationCommand } from './commands/delegate_registration';
import { ReportDelegateMisbehaviorCommand } from './commands/pom';
import { UnlockCommand } from './commands/unlock';
import { UpdateGeneratorKeyCommand } from './commands/update_generator_key';
import { VoteCommand } from './commands/vote';
import {
	MODULE_ID_DPOS,
	COMMAND_ID_UPDATE_GENERATOR_KEY,
	COMMAND_ID_VOTE,
	STORE_PREFIX_PREVIOUS_TIMESTAMP,
	EMPTY_KEY,
	STORE_PREFIX_DELEGATE,
	FAIL_SAFE_MISSED_BLOCKS,
	FAIL_SAFE_INACTIVE_WINDOW,
	STORE_PREFIX_GENESIS_DATA,
	ROUND_LENGTH,
	FACTOR_SELF_VOTES,
	PUNISHMENT_PERIOD,
	MIN_WEIGHT_STANDBY,
	STORE_PREFIX_SNAPSHOT,
	BFT_THRESHOLD,
	NUMBER_STANDBY_DELEGATES,
	EMPTY_BUFFER,
	NUMBER_ACTIVE_DELEGATES,
} from './constants';
import { DPoSEndpoint } from './endpoint';
import {
	configSchema,
	delegateStoreSchema,
	genesisDataStoreSchema,
	previousTimestampStoreSchema,
	snapshotStoreSchema,
} from './schemas';
import {
	DelegateAccount,
	PreviousTimestampData,
	RandomAPI,
	TokenAPI,
	ValidatorsAPI as TValidatorsAPI,
} from './types';
import {
	isEndOfRound,
	getRoundNumber,
	getAllDelegates,
	getDelegatesByActivity,
	getDelegateWeight,
	getSnapshotsBetweenRounds,
	shuffleValidatorsList,
	pickStandByDelegate,
} from './utils';
import { BFTAPI } from '../bft';

export class DPoSModule extends BaseModule {
	public id = MODULE_ID_DPOS;
	public name = 'dpos';
	public api = new DPoSAPI(this.id);
	public endpoint = new DPoSEndpoint(this.id);
	public configSchema = configSchema;
	public commands = [
		new DelegateRegistrationCommand(this.id),
		new ReportDelegateMisbehaviorCommand(this.id),
		new UnlockCommand(this.id),
		new UpdateGeneratorKeyCommand(this.id),
		new VoteCommand(this.id),
	];

	private _randomAPI!: RandomAPI;
	private _bftAPI!: BFTAPI;
	private _validatorsAPI!: ValidatorsAPI;
	private _tokenAPI!: TokenAPI;
	private _moduleConfig!: ModuleConfig;

	public addDependencies(
		randomAPI: RandomAPI,
		bftAPI: BFTAPI,
		validatorsAPI: ValidatorsAPI,
		tokenAPI: TokenAPI,
	) {
		this._bftAPI = bftAPI;
		this._randomAPI = randomAPI;
		this._validatorsAPI = validatorsAPI;
		this._tokenAPI = tokenAPI;

		const updateGeneratorKeyCommand = this.commands.find(
			command => command.id === COMMAND_ID_UPDATE_GENERATOR_KEY,
		) as UpdateGeneratorKeyCommand | undefined;

		if (!updateGeneratorKeyCommand) {
			throw Error("'updateGeneratorKeyCommand' is missing from DPoS module");
		}
		updateGeneratorKeyCommand.addDependencies((this._validatorsAPI as unknown) as TValidatorsAPI); // TODO: Fix setGeneratorList type mismatch in types and in validators API

		const voteCommand = this.commands.find(command => command.id === COMMAND_ID_VOTE) as
			| VoteCommand
			| undefined;
		if (!voteCommand) {
			throw new Error("'voteCommand' is missing from DPoS module");
		}
		voteCommand.addDependencies({
			tokenIDDPoS: this._moduleConfig.tokenIDDPoS,
			tokenAPI: this._tokenAPI,
		});
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async init(args: ModuleInitArgs) {
		const { moduleConfig } = args;

		this._moduleConfig.failSafeMissedBlocks =
			(moduleConfig.failSafeMissedBlocks as ModuleConfig['failSafeMissedBlocks']) ??
			FAIL_SAFE_MISSED_BLOCKS;
		this._moduleConfig.failSafeInactiveWindow =
			(moduleConfig.failSafeMissedBlocks as ModuleConfig['failSafeInactiveWindow']) ??
			FAIL_SAFE_INACTIVE_WINDOW;
		this._moduleConfig.roundLength =
			(moduleConfig.roundLength as ModuleConfig['roundLength']) ?? ROUND_LENGTH;
		this._moduleConfig.factorSelfVotes =
			(moduleConfig.factorSelfVotes as ModuleConfig['factorSelfVotes']) ?? FACTOR_SELF_VOTES;
		this._moduleConfig.punishmentWindow =
			(moduleConfig.punishmentWindow as ModuleConfig['punishmentWindow']) ?? PUNISHMENT_PERIOD;
		this._moduleConfig.minWeightStandby =
			(moduleConfig.minWeightStandby as ModuleConfig['minWeightStandby']) ?? MIN_WEIGHT_STANDBY;
		this._moduleConfig.bftThreshold =
			(moduleConfig.bftThreshold as ModuleConfig['bftThreshold']) ?? BFT_THRESHOLD;
		this._moduleConfig.numberActiveDelegates =
			(moduleConfig.numberActiveDelegates as ModuleConfig['numberActiveDelegates']) ??
			NUMBER_ACTIVE_DELEGATES;
		this._moduleConfig.numberStandbyDelegates =
			(moduleConfig.numberStandbyDelegates as ModuleConfig['numberStandbyDelegates']) ??
			NUMBER_STANDBY_DELEGATES;
		this._moduleConfig.roundLength =
			(moduleConfig.roundLength as ModuleConfig['roundLength']) ?? ROUND_LENGTH;
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async afterGenesisBlockExecute(_context: GenesisBlockExecuteContext): Promise<void> {
		// eslint-disable-next-line no-console
		console.log(this._bftAPI, this._randomAPI, this._validatorsAPI, this._moduleConfig);
	}

	public async afterBlockExecute(context: BlockAfterExecuteContext): Promise<void> {
		const { header, getAPIContext, getStore } = context;

		const newHeight = header.height;
		const apiContext = getAPIContext();
		const previousTimestampStore = getStore(this.id, STORE_PREFIX_PREVIOUS_TIMESTAMP);
		const previousTimestampData = await previousTimestampStore.getWithSchema<PreviousTimestampData>(
			EMPTY_KEY,
			previousTimestampStoreSchema,
		);
		const previousTimestamp = previousTimestampData.timestamp;
		const missedBlocks = await this._validatorsAPI.getGeneratorsBetweenTimestamps(
			apiContext,
			previousTimestamp,
			header.timestamp,
		);

		const generatorAtPreviousTimestamp = await this._validatorsAPI.getGeneratorAtTimestamp(
			apiContext,
			previousTimestamp,
		);
		const generatorAtCurrentTimestamp = await this._validatorsAPI.getGeneratorAtTimestamp(
			apiContext,
			header.timestamp,
		);

		(missedBlocks[generatorAtPreviousTimestamp.toString()] as number) -= 1; // TODO: Fix Error in validators module api
		(missedBlocks[generatorAtCurrentTimestamp.toString()] as number) -= 1; // TODO: Fix Error in validators module api

		const delegateStore = getStore(this.id, STORE_PREFIX_DELEGATE);
		for (const addressString of Object.keys(missedBlocks)) {
			const address = Buffer.from(addressString, 'hex'); // TODO: This won't work due to Line272 of validators api
			const delegate = await delegateStore.getWithSchema<DelegateAccount>(
				address,
				delegateStoreSchema,
			);
			delegate.consecutiveMissedBlocks += missedBlocks[addressString] as number; // TODO: Fix Error in validators module api

			if (
				delegate.consecutiveMissedBlocks > this._moduleConfig.failSafeMissedBlocks &&
				newHeight - delegate.lastGeneratedHeight > this._moduleConfig.failSafeInactiveWindow
			) {
				delegate.isBanned = true;
			}

			await delegateStore.setWithSchema(address, delegate, delegateStoreSchema);
		}

		const generator = await delegateStore.getWithSchema<DelegateAccount>(
			header.generatorAddress,
			delegateStoreSchema,
		);
		generator.consecutiveMissedBlocks = 0;
		generator.lastGeneratedHeight = newHeight;

		await delegateStore.setWithSchema(header.generatorAddress, generator, delegateStoreSchema);
		previousTimestampData.timestamp = header.timestamp;
		await previousTimestampStore.setWithSchema(
			EMPTY_KEY,
			previousTimestampData,
			previousTimestampStoreSchema,
		);

		const genesisStore = getStore(this.id, STORE_PREFIX_GENESIS_DATA);
		const genesisData = await genesisStore.getWithSchema<GenesisData>(
			EMPTY_KEY,
			genesisDataStoreSchema,
		);
		if (isEndOfRound(header.height, genesisData.height, this._moduleConfig.roundLength)) {
			const roundNumber = getRoundNumber(
				header.height,
				genesisData.height,
				this._moduleConfig.roundLength,
			);
			const currentWeights = new dataStructures.BufferMap<bigint>();
			const allUnbannedDelegates = (await getAllDelegates(delegateStore)).filter(
				delegate => !delegate.value.isBanned,
			);
			const allUnbannedDelegatesAddresses = allUnbannedDelegates.map(delegate => delegate.key);

			for (const address of allUnbannedDelegatesAddresses) {
				const delegateWeight = await getDelegateWeight(
					address,
					header.height,
					delegateStore,
					this._moduleConfig.punishmentWindow,
					this._moduleConfig.factorSelfVotes,
				);
				currentWeights.set(address, delegateWeight);
			}

			const { activeDelegates, inactiveDelegates } = getDelegatesByActivity(currentWeights); // TODO: Also pass numActiveDelegates for dynamic calculation
			const weightSnapshots = [];
			for (const [delegateAddress, delegateWeight] of inactiveDelegates.entries()) {
				if (delegateWeight >= this._moduleConfig.minWeightStandby) {
					weightSnapshots.push({
						delegateAddress,
						delegateWeight,
					});
				} else if (weightSnapshots.length < 2) {
					weightSnapshots.push({
						delegateAddress,
						delegateWeight,
					});
				}
			}

			const snapshotStore = getStore(this.id, STORE_PREFIX_SNAPSHOT);

			const activeDelegateAddresses = activeDelegates.entries().map(e => e[0]);
			const currentRoundSnapshot = {
				activeDelegates: activeDelegateAddresses,
				delegateWeightSnapshot: weightSnapshots,
			};
			const snapshotsToBeUpdated = await getSnapshotsBetweenRounds(
				roundNumber - 2,
				roundNumber,
				snapshotStore,
			);
			snapshotsToBeUpdated.shift();
			snapshotsToBeUpdated.push(currentRoundSnapshot);

			for (let i = 0; i < snapshotsToBeUpdated.length; i += 1) {
				await snapshotStore.setWithSchema(
					intToBuffer(roundNumber - i, 4),
					snapshotsToBeUpdated[snapshotsToBeUpdated.length - 1 - i],
					snapshotStoreSchema,
				);
			}

			if (roundNumber > genesisData.initRounds) {
				const validatorsTwoRoundsAgo = await snapshotStore.getWithSchema<SnapshotData>(
					intToBuffer(roundNumber - 2, 4),
					snapshotStoreSchema,
				);

				const bftWeights = validatorsTwoRoundsAgo.activeDelegates.map(address => ({
					address,
					bftWeight: BigInt(1), // TODO: BigInts should be number
				}));

				const currentBFTParameters = await this._bftAPI.getBFTParameters(apiContext, header.height);
				if (
					isDeepStrictEqual(currentBFTParameters.validators, bftWeights) ||
					currentBFTParameters.precommitThreshold !== BigInt(this._moduleConfig.bftThreshold) || // TODO: Remove BigInt and fix the type match
					currentBFTParameters.certificateThreshold !== BigInt(this._moduleConfig.bftThreshold) // TODO: Remove BigInt and fix the type match
				) {
					await this._bftAPI.setBFTParameters(
						apiContext,
						BigInt(this._moduleConfig.bftThreshold),
						BigInt(this._moduleConfig.bftThreshold),
						bftWeights,
					); // TODO: BigInts should be number
				}

				let validators: Buffer[] = [];
				const randomSeeds: Buffer[] = [];
				const pickedStandbyDelegates: Buffer[] = [];
				if (this._moduleConfig.numberStandbyDelegates === 2) {
					randomSeeds[0] = await this._randomAPI.getRandomBytes(
						apiContext,
						// eslint-disable-next-line no-bitwise
						header.height + 1 - ((ROUND_LENGTH * 3) >> 1),
						ROUND_LENGTH,
					);
					randomSeeds[1] = await this._randomAPI.getRandomBytes(
						apiContext,
						header.height + 1 - 2 * ROUND_LENGTH,
						ROUND_LENGTH,
					);
				} else if (this._moduleConfig.numberStandbyDelegates === 1) {
					randomSeeds[0] = await this._randomAPI.getRandomBytes(
						apiContext,
						// eslint-disable-next-line no-bitwise
						header.height + 1 - ((ROUND_LENGTH * 3) >> 1),
						ROUND_LENGTH,
					);
				} else {
					randomSeeds[0] = await this._randomAPI.getRandomBytes(
						apiContext,
						// eslint-disable-next-line no-bitwise
						header.height + 1 - ((ROUND_LENGTH * 3) >> 1),
						ROUND_LENGTH,
					);
				}

				const inactiveDelegatesToBePicked = inactiveDelegates.clone();
				for (let i = 0; i < this._moduleConfig.numberStandbyDelegates; i += 1) {
					const standbyDelegateAddress = pickStandByDelegate(
						inactiveDelegatesToBePicked,
						randomSeeds[i % randomSeeds.length],
					);
					if (standbyDelegateAddress.equals(EMPTY_BUFFER)) {
						throw new Error('Fail to pick standby delegate');
					}
					pickedStandbyDelegates.push(standbyDelegateAddress);
					inactiveDelegatesToBePicked.delete(standbyDelegateAddress);
				}

				validators = [...activeDelegateAddresses, ...pickedStandbyDelegates];
				const nextValidators = shuffleValidatorsList(validators, randomSeeds[0]);
				await this._validatorsAPI.setGeneratorList(apiContext, nextValidators);
			}
		}
	}
}
