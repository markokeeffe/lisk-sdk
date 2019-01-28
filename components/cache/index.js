/*
 * Copyright © 2018 Lisk Foundation
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

'use strict';

const redis = require('redis');
const { promisify } = require('util');
const transactionTypes = require('../../helpers/transaction_types');
const { CACHE } = require('./constants');

const errorCacheDisabled = 'Cache Disabled';

/**
 * Cache module.
 *
 * @class
 * @memberof components
 * @see Parent: {@link components}
 * @requires redis
 * @requires helpers/transaction_types
 * @param {Object} options - Cache options
 * @param {Object} logger
 * @todo Add description for the function and the params
 */
class Cache {
	constructor(options, logger) {
		this.options = options;
		this.logger = logger;
		this.cacheReady = false;
	}

	async bootstrap() {
		this.client = redis.createClient(this.options);
		this.client.once('error', this._onConnectionError.bind(this));
		this.client.once('ready', this._onReady.bind(this));
	}

	_onConnectionError(err) {
		// Called if the "error" event occured before "ready" event
		this.logger.info('App was unable to connect to Cache server', err);
		// Don't attempt to connect to server again as the connection was never established before
		return this.quit();
	}

	_onReady() {
		// Called after "ready" Cache event
		this.logger.info('App connected to Cache server');
		this.client.removeListener('error', this._onConnectionError);
		this.cacheReady = true;
		return this.client.on('error', err => {
			// Log Cache errors before and after server was connected
			this.logger.info('Cache:', err);
		});
	}

	/**
	 * Gets redis connection status.
	 *
	 * @returns {boolean}
	 * @todo Add description for the return value
	 */
	isConnected() {
		// Use client.ready because this constiable is updated on client connection
		return this.client && this.client.ready;
	}

	/**
	 * Gets caching readiness and the redis connection status.
	 *
	 * @returns {boolean}
	 * @todo Add description for the return value
	 */
	isReady() {
		return this.cacheReady && this.isConnected();
	}

	/**
	 * Gets json value for a key from redis.
	 *
	 * @param {string} key
	 * @todo Add description for the params and the return value
	 */
	async getJsonForKey(key) {
		this.logger.debug(
			['Cache - Get value for key:', key, '| Status:', this.isConnected()].join(
				' '
			)
		);
		if (!this.isConnected()) {
			return new Error(errorCacheDisabled);
		}

		const getAsync = promisify(this.client.get).bind(this.client);
		const value = await getAsync(key);
		return JSON.parse(value);
	}

	/**
	 * Sets json value for a key in redis.
	 *
	 * @param {string} key
	 * @param {Object} value
	 * @todo Add description for the params
	 * @todo Add @returns tag
	 */
	async setJsonForKey(key, value) {
		this.logger.debug(
			['Cache - Set value for key:', key, '| Status:', this.isConnected()].join(
				' '
			)
		);
		if (!this.isConnected()) {
			return new Error(errorCacheDisabled);
		}

		const setAsync = promisify(this.client.set).bind(this.client);
		// Cache server calls toString on objects, which converts it to object [object] so calling stringify before saving
		return setAsync(key, JSON.stringify(value));
	}

	/**
	 * Deletes json value for a key in redis.
	 *
	 * @param {string} key
	 * @todo Add description for the params
	 * @todo Add @returns tag
	 */
	async deleteJsonForKey(key) {
		this.logger.debug(
			[
				'Cache - Delete value for key:',
				key,
				'| Status:',
				this.isConnected(),
			].join(' ')
		);
		if (!this.isConnected()) {
			return new Error(errorCacheDisabled);
		}
		const delAsync = promisify(this.client.del).bind(this.client);
		return delAsync(key);
	}

	/**
	 * Scans keys with provided pattern in redis db and deletes the entries that match.
	 *
	 * @param {string} pattern
	 * @todo Add description for the params
	 * @todo Add @returns tag
	 */
	async removeByPattern(pattern) {
		if (!this.isConnected()) {
			return new Error(errorCacheDisabled);
		}
		let keys;
		let cursor = 0;

		const scanAsync = promisify(this.client.scan).bind(this.client);
		const delAsync = promisify(this.client.del).bind(this.client);

		const scan = () =>
			scanAsync(cursor, 'MATCH', pattern).then((res, err) => {
				if (err) throw err;

				cursor = res[0];
				keys = res[1];

				if (keys.length > 0) {
					delAsync(keys);
					return scan();
				}

				if (cursor === '0') {
					return null;
				}

				return scan();
			});

		return scan();
	}

	/**
	 * Removes all entries from redis db.
	 *
	 * @todo Add description for the params
	 * @todo Add @returns tag
	 */
	async flushDb() {
		this.logger.debug('Cache - Flush database');
		if (!this.isConnected()) {
			return new Error(errorCacheDisabled);
		}
		const flushdbAsync = promisify(this.client.flushdb).bind(this.client);
		return flushdbAsync();
	}

	/**
	 * Quits established redis connection upon process exit.
	 *
	 * @todo Add description for the params
	 * @todo Add @returns tag
	 */
	async cleanup() {
		this.logger.debug('Cache - Clean up database');
		return this.quit();
	}

	/**
	 * Quits established redis connection.
	 *
	 * @todo Add description for the params
	 * @todo Add @returns tag
	 */
	async quit() {
		this.logger.debug('Cache - Quit database');
		if (!this.isConnected()) {
			// Because connection is not established in the first place
			return null;
		}
		const quitAsync = promisify(this.client.quit).bind(this.client);
		return quitAsync();
	}

	/**
	 * Clears cache entries for given pattern.
	 *
	 * @param {string} pattern
	 * @todo Add description for the params
	 * @todo Add @returns tag
	 */
	async clearCacheFor(pattern) {
		this.logger.debug(
			['Cache - clearCacheFor', pattern, '| Status:', this.isConnected()].join(
				' '
			)
		);

		if (!this.isReady()) {
			return new Error(errorCacheDisabled);
		}

		const err = await this.removeByPattern(pattern);
		if (err) {
			this.logger.error(
				[
					'Cache - Error clearing keys with pattern:',
					pattern,
					'on new block',
				].join(' ')
			);
		} else {
			this.logger.debug(
				[
					'Cache - Keys with pattern:',
					pattern,
					'cleared from cache on new block',
				].join(' ')
			);
		}
		return err;
	}

	/**
	 * Clears all cache entries upon round finish.
	 *
	 * @todo Add description for the params
	 * @todo Add @returns tag
	 */
	async onFinishRound() {
		this.logger.debug(
			['Cache - onFinishRound', '| Status:', this.isConnected()].join(' ')
		);
		if (!this.isReady()) {
			return new Error(errorCacheDisabled);
		}
		const pattern = CACHE.KEYS.delegatesApi;
		const err = await this.removeByPattern(pattern);
		if (err) {
			return this.logger.error(
				[
					'Cache - Error clearing keys with pattern:',
					pattern,
					'round finish',
				].join(' ')
			);
		}
		return this.logger.debug(
			[
				'Cache - Keys with pattern:',
				pattern,
				'cleared from cache on new Round',
			].join(' ')
		);
	}

	/**
	 * Clears all cache entries if there is a delegate type transaction after transactions saved.
	 *
	 * @param {transactions[]} transactions
	 * @todo Add description for the params
	 * @todo Add @returns tag
	 */
	async onTransactionsSaved(transactions) {
		this.logger.debug(
			['Cache - onTransactionsSaved', '| Status:', this.isConnected()].join(' ')
		);
		if (!this.isReady()) {
			return new Error(errorCacheDisabled);
		}

		const pattern = CACHE.KEYS.delegatesApi;
		const delegateTransaction = transactions.find(
			transaction =>
				!!transaction && transaction.type === transactionTypes.DELEGATE
		);

		if (!delegateTransaction) {
			return null;
		}

		const removeByPatternErr = await this.removeByPattern(pattern);
		if (removeByPatternErr) {
			this.logger.error(
				[
					'Cache - Error clearing keys with pattern:',
					pattern,
					'on delegate transaction',
				].join(' ')
			);
		} else {
			this.logger.debug(
				[
					'Cache - Keys with pattern:',
					pattern,
					'cleared from cache on delegate transaction',
				].join(' ')
			);
		}

		const deleteJsonForKeyErr = await this.deleteJsonForKey(
			CACHE.KEYS.transactionCount
		);
		if (deleteJsonForKeyErr) {
			return this.logger.error(
				`Cache - Error clearing keys: ${CACHE.KEYS.transactionCount}`
			);
		}
		return this.logger.debug(
			`Cache - Keys ${CACHE.KEYS.transactionCount} cleared from cache`
		);
	}

	/**
	 * Disables any changes in cache while syncing.
	 */
	onSyncStarted() {
		this.cacheReady = false;
	}

	/**
	 * Enables changes in cache after syncing finished.
	 */
	onSyncFinished() {
		this.cacheReady = true;
	}
}

module.exports = Cache;
