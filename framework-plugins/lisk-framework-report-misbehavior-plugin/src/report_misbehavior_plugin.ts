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
 */
import { validator, LiskValidationError } from '@liskhq/lisk-validator';
import { KVStore } from '@liskhq/lisk-db';
import { codec } from '@liskhq/lisk-codec';
import { BlockHeader, RawBlock, Transaction, TAG_TRANSACTION } from '@liskhq/lisk-chain';
import {
	decryptPassphraseWithPassword,
	parseEncryptedPassphrase,
	getAddressAndPublicKeyFromPassphrase,
	getAddressFromPassphrase,
	signData,
} from '@liskhq/lisk-cryptography';
import { ActionsDefinition, BasePlugin, BaseChannel } from 'lisk-framework';
import {
	getDBInstance,
	saveBlockHeaders,
	getContradictingBlockHeader,
	decodeBlockHeader,
	clearBlockHeaders,
} from './db';
import { ReportMisbehaviorPluginConfig, State } from './types';
import { postBlockEventSchema, configSchema, actionParamsSchema } from './schemas';

export class ReportMisbehaviorPlugin extends BasePlugin<ReportMisbehaviorPluginConfig> {
	public name = 'reportMisbehavior';
	public configSchema = configSchema;

	private _pluginDB!: KVStore;
	private readonly _state: State = { currentHeight: 0 };
	private _channel!: BaseChannel;
	private _clearBlockHeadersIntervalId!: NodeJS.Timer | undefined;

	public get nodeModulePath(): string {
		return __filename;
	}

	public get actions(): ActionsDefinition {
		return {
			authorize: (params?: Record<string, unknown>): { result: string } => {
				const errors = validator.validate(actionParamsSchema, params as Record<string, unknown>);

				if (errors.length) {
					throw new LiskValidationError([...errors]);
				}

				const { enable, password } = params as Record<string, unknown>;

				try {
					const parsedEncryptedPassphrase = parseEncryptedPassphrase(
						this.config.encryptedPassphrase,
					);

					const passphrase = decryptPassphraseWithPassword(
						parsedEncryptedPassphrase,
						password as string,
					);

					const { publicKey } = getAddressAndPublicKeyFromPassphrase(passphrase);

					this._state.publicKey = enable ? publicKey : undefined;
					this._state.passphrase = enable ? passphrase : undefined;
					const changedState = enable ? 'enabled' : 'disabled';

					return {
						result: `Successfully ${changedState} the reporting of misbehavior.`,
					};
				} catch (error) {
					throw new Error('Password given is not valid.');
				}
			},
		};
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async load(channel: BaseChannel): Promise<void> {
		this._channel = channel;

		// TODO: https://github.com/LiskHQ/lisk-sdk/issues/6201
		this._pluginDB = await getDBInstance(this.dataPath);
		// Listen to new block and delete block events
		this._subscribeToChannel();
		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		this._clearBlockHeadersIntervalId = setInterval(() => {
			clearBlockHeaders(this._pluginDB, this.schemas, this._state.currentHeight).catch(error =>
				this.logger.error(error),
			);
		}, this.config.clearBlockHeadersInterval);
	}

	public async unload(): Promise<void> {
		clearInterval(this._clearBlockHeadersIntervalId as NodeJS.Timer);

		await this._pluginDB.close();
	}

	private _subscribeToChannel(): void {
		this._channel.subscribe('app:network:event', async (eventData?: Record<string, unknown>) => {
			const { event, data } = eventData as { event: string; data: unknown };

			if (event === 'postBlock') {
				const errors = validator.validate(postBlockEventSchema, data as Record<string, unknown>);
				if (errors.length > 0) {
					this.logger.error(errors, 'Invalid block data');
					return;
				}
				const blockData = data as { block: string };
				const { header } = codec.decode<RawBlock>(
					this.schemas.block,
					Buffer.from(blockData.block, 'hex'),
				);
				try {
					const saved = await saveBlockHeaders(this._pluginDB, this.schemas, header);
					if (!saved) {
						return;
					}
					const decodedBlockHeader = decodeBlockHeader(header, this.schemas);

					// Set new currentHeight
					if (decodedBlockHeader.height > this._state.currentHeight) {
						this._state.currentHeight = decodedBlockHeader.height;
					}
					const contradictingBlock = await getContradictingBlockHeader(
						this._pluginDB,
						decodedBlockHeader,
						this.schemas,
					);
					if (contradictingBlock && this._state.passphrase) {
						const encodedTransaction = await this._createPoMTransaction(
							decodedBlockHeader,
							contradictingBlock,
						);
						const result = await this._channel.invoke<{
							transactionId?: string;
						}>('app:postTransaction', {
							transaction: encodedTransaction,
						});

						this.logger.debug('Sent Report misbehavior transaction', result.transactionId);
					}
				} catch (error) {
					this.logger.error(error);
				}
			}
		});
	}

	private async _createPoMTransaction(
		contradictingBlock: BlockHeader,
		decodedBlockHeader: BlockHeader,
	): Promise<string> {
		// ModuleID:5 (DPoS), AssetID:3 (PoMAsset)
		const pomAssetInfo = this.schemas.transactionsAssets.find(
			({ moduleID, assetID }) => moduleID === 5 && assetID === 3,
		);

		if (!pomAssetInfo) {
			throw new Error('PoM asset schema is not registered in the application.');
		}

		// Assume passphrase is checked before calling this function
		const passphrase = this._state.passphrase as string;

		const encodedAccount = await this._channel.invoke<string>('app:getAccount', {
			address: getAddressFromPassphrase(passphrase).toString('hex'),
		});

		const {
			sequence: { nonce },
		} = codec.decode<{ sequence: { nonce: bigint } }>(
			this.schemas.account,
			Buffer.from(encodedAccount, 'hex'),
		);

		const pomTransactionAsset = {
			header1: decodedBlockHeader,
			header2: contradictingBlock,
		};

		const { networkIdentifier } = await this._channel.invoke<{ networkIdentifier: string }>(
			'app:getNodeInfo',
		);

		const encodedAsset = codec.encode(pomAssetInfo.schema, pomTransactionAsset);

		const tx = new Transaction({
			moduleID: pomAssetInfo.moduleID,
			assetID: pomAssetInfo.assetID,
			nonce,
			senderPublicKey:
				this._state.publicKey ?? getAddressAndPublicKeyFromPassphrase(passphrase).publicKey,
			fee: BigInt(this.config.fee), // TODO: The static fee should be replaced by fee estimation calculation
			asset: encodedAsset,
			signatures: [],
		});

		(tx.signatures as Buffer[]).push(
			signData(
				TAG_TRANSACTION,
				Buffer.from(networkIdentifier, 'hex'),
				tx.getSigningBytes(),
				passphrase,
			),
		);

		return tx.getBytes().toString('hex');
	}
}
