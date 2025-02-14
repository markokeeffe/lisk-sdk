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
 */

// Parameters passed by `child_process.fork(_, parameters)`

import { BasePlugin, InstantiablePlugin } from '../plugins/base_plugin';
import { ApplicationConfigForPlugin, PluginConfig, SocketPaths } from '../types';
import { IPCChannel } from './channels';

const modulePath: string = process.argv[2];
const moduleExportName: string = process.argv[3];
// eslint-disable-next-line import/no-dynamic-require,@typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-member-access
const Klass: InstantiablePlugin = require(modulePath)[moduleExportName];
let channel: IPCChannel;
let plugin: BasePlugin;

const _loadPlugin = async (
	config: Record<string, unknown>,
	appConfig: ApplicationConfigForPlugin,
	ipcConfig: {
		[key: string]: unknown;
		rpc: SocketPaths;
	},
): Promise<void> => {
	plugin = new Klass();
	const pluginName = plugin.name;

	channel = new IPCChannel(pluginName, plugin.events, plugin.actions, {
		socketsPath: ipcConfig.rpc.ipc.path,
	});

	await channel.registerToBus();

	channel.publish(`${pluginName}:registeredToBus`);
	channel.publish(`${pluginName}:loading:started`);

	await plugin.init({ appConfig, channel, config });
	await plugin.load(channel);

	channel.publish(`${pluginName}:loading:finished`);
};

const _unloadPlugin = async (code = 0) => {
	const pluginName = plugin.name;

	channel.publish(`${pluginName}:unloading:started`);
	try {
		await plugin.unload();
		channel.publish(`${pluginName}:unloading:finished`);
		channel.cleanup();
		process.exit(code);
	} catch (error) {
		channel.publish(`${pluginName}:unloading:error`, error);
		channel.cleanup();
		process.exit(1);
	}
};

process.on(
	'message',
	({
		action,
		config,
		appConfig,
		ipcConfig,
	}: {
		action: string;
		config: PluginConfig;
		appConfig: ApplicationConfigForPlugin;
		ipcConfig: {
			[key: string]: unknown;
			rpc: SocketPaths;
		};
	}) => {
		const internalWorker = async (): Promise<void> => {
			if (action === 'load') {
				await _loadPlugin(
					config as {
						[key: string]: unknown;
						rpc: SocketPaths;
					},
					appConfig,
					ipcConfig,
				);
			} else if (action === 'unload') {
				await _unloadPlugin();
			} else {
				console.error(`Unknown child process plugin action: ${action}`);
			}
		};
		internalWorker().catch((err: Error) => err);
	},
);

// A rare case, if master process is disconnecting IPC then unload the plugin
process.on('disconnect', () => {
	const internalWorker = async (): Promise<void> => {
		await _unloadPlugin(1);
	};

	internalWorker().catch((err: Error) => err);
});

process.once('SIGINT', () => {
	// Do nothing and gave time to master process to cleanup properly
});

process.once('SIGTERM', () => {
	// Do nothing and gave time to master process to cleanup properly
});
