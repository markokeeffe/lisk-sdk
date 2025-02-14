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

import { homedir } from 'os';
import { removeSync, mkdirSync } from 'fs-extra';
import { resolve as pathResolve } from 'path';
import { IPCChannel } from '../../../src/controller/channels';
import { IPCServer } from '../../../src/controller/ipc/ipc_server';

// TODO: ZeroMQ tests are unstable with jest https://github.com/zeromq/zeromq.js/issues/416
// eslint-disable-next-line jest/no-disabled-tests
describe.skip('IPCChannelWithoutBus', () => {
	// Arrange
	const socketsDir = pathResolve(`${homedir()}/.lisk/integration/ipc_channel_without_bus/sockets`);

	const config: any = {
		socketsPath: socketsDir,
	};

	const alpha = {
		moduleName: 'alphaName',
		events: ['alpha1', 'alpha2'],
		actions: {
			multiplyByTwo: {
				handler: (params: any) => params.val * 2,
			},
			multiplyByThree: {
				handler: (params: any) => params.val * 3,
			},
		},
	};

	const beta = {
		moduleName: 'betaName',
		events: ['beta1', 'beta2'],
		actions: {
			divideByTwo: {
				handler: (params: any) => params.val / 2,
			},
			divideByThree: {
				handler: (params: any) => params.val / 3,
			},
		},
	};

	describe('Communication without registering to bus', () => {
		let alphaChannel: IPCChannel;
		let betaChannel: IPCChannel;
		let server: IPCServer;

		beforeAll(async () => {
			mkdirSync(socketsDir, { recursive: true });

			// Arrange
			server = new IPCServer({
				socketsDir,
				name: 'bus',
			});

			const listenForRPC = async () => {
				for await (const [_action] of server.rpcServer) {
					await server.rpcServer.send('myData');
				}
			};

			await server.start();

			const listenForEvents = async () => {
				for await (const [eventName, eventValue] of server.subSocket) {
					await server.pubSocket.send([eventName, eventValue]);
				}
			};

			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			Promise.all<void>([listenForRPC(), listenForEvents()]).catch(_ => ({}));

			alphaChannel = new IPCChannel(alpha.moduleName, alpha.events, alpha.actions, config);

			betaChannel = new IPCChannel(beta.moduleName, beta.events, beta.actions, config);

			await alphaChannel.startAndListen();
			await betaChannel.startAndListen();
		});

		afterAll(async () => {
			server.stop();
			alphaChannel.cleanup();
			betaChannel.cleanup();

			removeSync(socketsDir);
		});

		describe('#subscribe', () => {
			it('should be able to subscribe to an event.', async () => {
				// Arrange
				const betaEventData = { data: '#DATA' };
				const eventName = beta.events[0];

				const donePromise = new Promise<void>(resolve => {
					// Act
					alphaChannel.subscribe(`${beta.moduleName}:${eventName}`, data => {
						// Assert
						expect(data).toEqual(betaEventData);
						resolve();
					});
				});

				betaChannel.publish(`${beta.moduleName}:${eventName}`, betaEventData);

				return donePromise;
			});

			it('should be able to subscribe to an event once.', async () => {
				// Arrange
				const betaEventData = { data: '#DATA' };
				const eventName = beta.events[0];
				const donePromise = new Promise<void>(resolve => {
					// Act
					alphaChannel.once(`${beta.moduleName}:${eventName}`, data => {
						// Assert
						expect(data).toEqual(betaEventData);
						resolve();
					});
				});

				betaChannel.publish(`${beta.moduleName}:${eventName}`, betaEventData);

				return donePromise;
			});
		});

		describe('#publish', () => {
			it('should be able to publish an event.', async () => {
				// Arrange
				const alphaEventData = { data: '#DATA' };
				const eventName = alpha.events[0];

				const donePromise = new Promise<void>(done => {
					// Act
					betaChannel.once(`${alpha.moduleName}:${eventName}`, data => {
						// Assert
						expect(data).toEqual(alphaEventData);
						done();
					});
				});

				alphaChannel.publish(`${alpha.moduleName}:${eventName}`, alphaEventData);

				return donePromise;
			});
		});
	});
});
