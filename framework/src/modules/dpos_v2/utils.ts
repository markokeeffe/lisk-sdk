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

import { NotFoundError } from '@liskhq/lisk-chain';
import { hash, intToBuffer, verifyData } from '@liskhq/lisk-cryptography';
import { dataStructures } from '@liskhq/lisk-utils';
import { DelegateAccount, SnapshotData, UnlockingObject, VoterData } from './types';
import {
	EMPTY_BUFFER,
	PUNISHMENT_PERIOD,
	SELF_VOTE_PUNISH_TIME,
	VOTER_PUNISH_TIME,
	WAIT_TIME_SELF_VOTE,
	WAIT_TIME_VOTE,
} from './constants';
import { delegateStoreSchema, snapshotStoreSchema, voterStoreSchema } from './schemas';
import { SubStore } from '../../node/state_machine/types';

export const sortUnlocking = (unlocks: UnlockingObject[]): void => {
	unlocks.sort((a, b) => {
		if (!a.delegateAddress.equals(b.delegateAddress)) {
			return a.delegateAddress.compare(b.delegateAddress);
		}
		if (a.unvoteHeight !== b.unvoteHeight) {
			return b.unvoteHeight - a.unvoteHeight;
		}
		const diff = b.amount - a.amount;
		if (diff > BigInt(0)) {
			return 1;
		}
		if (diff < BigInt(0)) {
			return -1;
		}

		return 0;
	});
};

export const getMinPunishedHeight = (
	senderAddress: Buffer,
	delegateAddress: Buffer,
	pomHeights: number[],
): number => {
	if (pomHeights.length === 0) {
		return 0;
	}

	const lastPomHeight = Math.max(...pomHeights);

	// https://github.com/LiskHQ/lips/blob/master/proposals/lip-0024.md#update-to-validity-of-unlock-transaction
	return senderAddress.equals(delegateAddress)
		? lastPomHeight + SELF_VOTE_PUNISH_TIME
		: lastPomHeight + VOTER_PUNISH_TIME;
};

export const getPunishmentPeriod = (
	senderAddress: Buffer,
	delegateAddress: Buffer,
	pomHeights: number[],
	lastBlockHeight: number,
): number => {
	const currentHeight = lastBlockHeight + 1;
	const minPunishedHeight = getMinPunishedHeight(senderAddress, delegateAddress, pomHeights);
	const remainingBlocks = minPunishedHeight - currentHeight;

	return remainingBlocks < 0 ? 0 : remainingBlocks;
};

export const getMinWaitingHeight = (
	senderAddress: Buffer,
	delegateAddress: Buffer,
	unlockObject: UnlockingObject,
): number =>
	unlockObject.unvoteHeight +
	(senderAddress.equals(delegateAddress) ? WAIT_TIME_SELF_VOTE : WAIT_TIME_VOTE);

export const getWaitingPeriod = (
	senderAddress: Buffer,
	delegateAddress: Buffer,
	lastBlockHeight: number,
	unlockObject: UnlockingObject,
): number => {
	const currentHeight = lastBlockHeight + 1;
	const minWaitingHeight = getMinWaitingHeight(senderAddress, delegateAddress, unlockObject);
	const remainingBlocks = minWaitingHeight - currentHeight;

	return remainingBlocks < 0 ? 0 : remainingBlocks;
};

export const isNullCharacterIncluded = (input: string): boolean =>
	new RegExp(/\\0|\\u0000|\\x00/).test(input);

export const isUsername = (username: string): boolean => {
	if (isNullCharacterIncluded(username)) {
		return false;
	}

	if (username !== username.trim().toLowerCase()) {
		return false;
	}

	return /^[a-z0-9!@$&_.]+$/g.test(username);
};

export const validateSignature = (
	tag: string,
	networkIdentifier: Buffer,
	publicKey: Buffer,
	signature: Buffer,
	bytes: Buffer,
): boolean => verifyData(tag, networkIdentifier, bytes, signature, publicKey);

export const isCurrentlyPunished = (height: number, pomHeights: ReadonlyArray<number>): boolean => {
	if (pomHeights.length === 0) {
		return false;
	}
	const lastPomHeight = Math.max(...pomHeights);
	if (height - lastPomHeight < PUNISHMENT_PERIOD) {
		return true;
	}

	return false;
};

export const getVoterOrDefault = async (voterStore: SubStore, address: Buffer) => {
	try {
		const voterData = await voterStore.getWithSchema<VoterData>(address, voterStoreSchema);
		return voterData;
	} catch (error) {
		if (!(error instanceof NotFoundError)) {
			throw error;
		}

		const voterData = {
			sentVotes: [],
			pendingUnlocks: [],
		};
		return voterData;
	}
};

export const getRoundNumber = (height: number, genesisHeight: number, roundLength: number) =>
	Math.ceil(height - genesisHeight - roundLength);

export const isEndOfRound = (height: number, genesisHeight: number, roundLength: number) =>
	(height - genesisHeight) % roundLength === 0;

export const getAllDelegates = async (delegateStore: SubStore) => {
	const startBuf = Buffer.alloc(20);
	const endBuf = Buffer.alloc(20, 255);
	const allDelegates = await delegateStore.iterateWithSchema<DelegateAccount>(
		{ start: startBuf, end: endBuf },
		delegateStoreSchema,
	);

	return allDelegates;
};

export const getDelegatesByActivity = (currentWeights: dataStructures.BufferMap<bigint>) => {
	const orderedDelegates = [...currentWeights.entries()];
	orderedDelegates.sort((a, b) => {
		if (a[1] !== b[1]) {
			if (a[1] > b[1]) {
				return -1;
			}
			return 1;
		}
		return a[0].compare(b[0]);
	});

	const activeDelegateEntries = orderedDelegates.slice(100);
	const inactiveDelegateEntries = orderedDelegates.slice(101, orderedDelegates.length);

	const activeDelegates = new dataStructures.BufferMap<bigint>(
		Object.fromEntries(activeDelegateEntries),
	);
	const inactiveDelegates = new dataStructures.BufferMap<bigint>(
		Object.fromEntries(inactiveDelegateEntries),
	);

	return {
		activeDelegates,
		inactiveDelegates,
	};
};

export const getDelegateWeight = async (
	address: Buffer,
	height: number,
	delegateStore: SubStore,
	punishmentWindow: number,
	factorSelfVotes: number,
) => {
	const delegate = await delegateStore.getWithSchema<DelegateAccount>(address, delegateStoreSchema);
	const doesDelegateHavePomInWindow = delegate.pomHeights.some(
		h => height - h > 0 && height - h < punishmentWindow,
	);
	if (doesDelegateHavePomInWindow) {
		return BigInt(0);
	}
	return BigInt(1) * BigInt(factorSelfVotes); // TODO: Change
};

export const getSnapshotsBetweenRounds = async (
	startRoundNumber: number,
	endRoundNumber: number,
	snapshotStore: SubStore,
) => {
	const snapshots = [];
	for (let i = startRoundNumber; i <= endRoundNumber; i += 1) {
		const snapshot = await snapshotStore.getWithSchema<SnapshotData>(
			intToBuffer(i, 4),
			snapshotStoreSchema,
		);
		snapshots.push(snapshot);
	}

	return snapshots;
};

export const shuffleValidatorsList = (
	addresses: ReadonlyArray<Buffer>,
	randomSeed: Buffer,
): Buffer[] => {
	const delegateList = [...addresses].map(delegate => ({
		address: delegate,
	})) as { address: Buffer; roundHash: Buffer }[];

	for (const delegate of delegateList) {
		const seedSource = Buffer.concat([randomSeed, delegate.address]);
		delegate.roundHash = hash(seedSource);
	}

	delegateList.sort((delegate1, delegate2) => {
		const diff = delegate1.roundHash.compare(delegate2.roundHash);
		if (diff !== 0) {
			return diff;
		}

		return delegate1.address.compare(delegate2.address);
	});

	return delegateList.map(delegate => delegate.address);
};

export const pickStandByDelegate = (
	delegateWeights: dataStructures.BufferMap<bigint>,
	randomSeed: Buffer,
): Buffer => {
	const seedNumber = randomSeed.readBigUInt64BE();
	const delegateWeightEntries = delegateWeights.entries();
	const totalVoteWeight = delegateWeightEntries.reduce(
		(prev, current) => prev + current[1],
		BigInt(0),
	);

	let threshold = seedNumber % totalVoteWeight;
	for (const [address, weight] of delegateWeightEntries) {
		if (weight > threshold) {
			return address;
		}
		threshold -= weight;
	}

	return EMPTY_BUFFER;
};
