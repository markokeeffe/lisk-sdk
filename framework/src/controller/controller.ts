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

import { KVStore } from '@liskhq/lisk-db';
import * as childProcess from 'child_process';
import { ChildProcess } from 'child_process';
import * as path from 'path';
import { APP_IDENTIFIER, RPC_MODES } from '../constants';
import { Logger } from '../logger';
import { getEndpointHandlers } from '../endpoint';
import { BasePlugin, getPluginExportPath, validatePluginSpec } from '../plugins/base_plugin';
import { systemDirs } from '../system_dirs';
import { ApplicationConfigForPlugin, EndpointHandlers, PluginConfig, RPCConfig } from '../types';
import { Bus } from './bus';
import { BaseChannel } from './channels';
import { InMemoryChannel } from './channels/in_memory_channel';
import { HTTPServer } from './http/http_server';
import { IPCServer } from './ipc/ipc_server';
import { WSServer } from './ws/ws_server';

export interface ControllerOptions {
	readonly appConfig: ApplicationConfigForPlugin;
	readonly pluginConfigs: Record<string, PluginConfig>;
}

interface ControllerInitArg {
	readonly blockchainDB: KVStore;
	readonly logger: Logger;
	readonly endpoints: EndpointHandlers;
	readonly events: string[];
}

interface ControllerConfig {
	readonly dataPath: string;
	readonly dirs: {
		readonly dataPath: string;
		readonly data: string;
		readonly tmp: string;
		readonly logs: string;
		readonly sockets: string;
		readonly pids: string;
	};
	rpc: RPCConfig;
}

export class Controller {
	private readonly _appConfig: ApplicationConfigForPlugin;
	private readonly _pluginConfigs: Record<string, PluginConfig>;
	private readonly _config: ControllerConfig;
	private readonly _childProcesses: Record<string, ChildProcess>;
	private readonly _inMemoryPlugins: Record<string, { plugin: BasePlugin; channel: BaseChannel }>;
	private readonly _plugins: { [key: string]: BasePlugin };
	private readonly _endpointHandlers: { [namespace: string]: EndpointHandlers };

	private readonly _bus: Bus;
	private readonly _internalIPCServer: IPCServer;
	private readonly _externalIPCServer?: IPCServer;
	private readonly _wsServer?: WSServer;
	private readonly _httpServer?: HTTPServer;

	// Injected at init
	private _logger!: Logger;
	private _blockchainDB!: KVStore;

	// Assigned at init
	private _channel?: InMemoryChannel;

	public constructor(options: ControllerOptions) {
		this._plugins = {};
		this._inMemoryPlugins = {};
		this._childProcesses = {};
		this._endpointHandlers = {};

		this._appConfig = options.appConfig;
		this._pluginConfigs = options.pluginConfigs ?? {};
		const dirs = systemDirs(options.appConfig.label, options.appConfig.rootPath);
		this._config = {
			dataPath: dirs.dataPath,
			dirs,
			rpc: {
				modes: options.appConfig.rpc.modes,
				ipc: {
					path: options.appConfig.rpc.ipc?.path ?? dirs.sockets,
				},
				ws: options.appConfig.rpc.ws,
				http: options.appConfig.rpc.http,
			},
		};

		this._internalIPCServer = new IPCServer({
			socketsDir: this._config.dirs.sockets,
			name: 'bus',
		});

		if (this._config.rpc.modes.includes(RPC_MODES.IPC) && this._config.rpc.ipc) {
			this._externalIPCServer = new IPCServer({
				socketsDir: this._config.rpc.ipc.path,
				name: 'bus',
				externalSocket: true,
			});
		}

		if (this._config.rpc.modes.includes(RPC_MODES.WS) && this._config.rpc.ws) {
			this._wsServer = new WSServer({
				path: this._config.rpc.ws.path,
				port: this._config.rpc.ws.port,
				host: this._config.rpc.ws.host,
			});
		}

		if (this._config.rpc.modes.includes(RPC_MODES.HTTP) && this._config.rpc.http) {
			this._httpServer = new HTTPServer({
				host: this._config.rpc.http.host,
				port: this._config.rpc.http.port,
			});
		}

		this._bus = new Bus({
			externalIPCServer: this._externalIPCServer,
			internalIPCServer: this._internalIPCServer,
			wsServer: this._wsServer,
			httpServer: this._httpServer,
		});
	}

	public get channel(): InMemoryChannel {
		if (!this._channel) {
			throw new Error('Channel is not initialized.');
		}
		return this._channel;
	}

	public getEndpoints(): ReadonlyArray<string> {
		return this._bus.getEndpoints();
	}

	public getEvents(): ReadonlyArray<string> {
		return this._bus.getEvents();
	}

	public init(arg: ControllerInitArg): void {
		this._blockchainDB = arg.blockchainDB;
		this._logger = arg.logger;
		// Create root channel
		this._channel = new InMemoryChannel(
			this._logger,
			this._blockchainDB,
			APP_IDENTIFIER,
			arg.events,
			arg.endpoints,
			{ skipInternalEvents: true },
		);
	}

	public registerPlugin(plugin: BasePlugin, options: PluginConfig): void {
		const pluginName = plugin.name;

		if (Object.keys(this._plugins).includes(pluginName)) {
			throw new Error(`A plugin with name "${pluginName}" already registered.`);
		}

		if (options.loadAsChildProcess) {
			if (!getPluginExportPath(plugin)) {
				throw new Error(
					`Unable to register plugin "${pluginName}" to load as child process. Package name or __filename must be specified in nodeModulePath.`,
				);
			}
		}

		this._pluginConfigs[pluginName] = Object.assign(this._pluginConfigs[pluginName] ?? {}, options);

		validatePluginSpec(plugin);

		this._plugins[pluginName] = plugin;
	}

	public registerEndpoint(namespace: string, handlers: EndpointHandlers): void {
		if (this._endpointHandlers[namespace]) {
			throw new Error(`Endpoint for ${namespace} is already registered.`);
		}
		this._endpointHandlers[namespace] = handlers;
	}

	public async start(): Promise<void> {
		this._logger.info('Starting controller');
		await this.channel.registerToBus(this._bus);
		for (const [namespace, handlers] of Object.entries(this._endpointHandlers)) {
			const channel = new InMemoryChannel(
				this._logger,
				this._blockchainDB,
				namespace,
				[],
				handlers,
			);
			await channel.registerToBus(this._bus);
		}
		await this._bus.start(this._logger);
		for (const name of Object.keys(this._plugins)) {
			const plugin = this._plugins[name];
			const config = this._pluginConfigs[name] ?? {};

			if (config.loadAsChildProcess) {
				await this._loadChildProcessPlugin(plugin, config, this._appConfig);
			} else {
				await this._loadInMemoryPlugin(plugin, config, this._appConfig);
			}
		}
	}

	public async stop(_code?: number, reason?: string): Promise<void> {
		this._logger.info('Stopping Controller');

		if (reason) {
			this._logger.debug(`Reason: ${reason}`);
		}

		try {
			this._logger.debug('Plugins cleanup started');
			await this._unloadPlugins();
			this._logger.debug('Plugins cleanup completed');

			this._logger.debug('Bus cleanup started');
			await this._bus.cleanup();
			this._logger.debug('Bus cleanup completed');

			this._logger.info('Controller cleanup completed');
		} catch (err) {
			this._logger.error(err, 'Controller cleanup failed');
		}
	}

	private async _unloadPlugins(): Promise<void> {
		const pluginsToUnload = [
			...Object.keys(this._inMemoryPlugins),
			...Object.keys(this._childProcesses),
		];

		let hasError = false;

		for (const name of pluginsToUnload) {
			try {
				// Unload in-memory plugins
				if (this._inMemoryPlugins[name]) {
					await this._unloadInMemoryPlugin(name);

					// Unload child process plugins
				} else if (this._childProcesses[name]) {
					await this._unloadChildProcessPlugin(name);
				} else {
					throw new Error(`Unknown plugin "${name}" was asked to unload.`);
				}
			} catch (error) {
				this._logger.error(error);
				hasError = true;
			}
		}

		if (hasError) {
			throw new Error('Unload Plugins failed');
		}
	}

	private async _loadInMemoryPlugin(
		plugin: BasePlugin,
		config: PluginConfig,
		appConfig: ApplicationConfigForPlugin,
	): Promise<void> {
		const { name } = plugin;
		this._logger.info(name, 'Loading in-memory plugin');

		const channel = new InMemoryChannel(
			this._logger,
			this._blockchainDB,
			name,
			plugin.events,
			plugin.endpoint ? getEndpointHandlers(plugin.endpoint) : {},
		);
		await channel.registerToBus(this._bus);
		channel.publish(`${name}:registeredToBus`);
		channel.publish(`${name}:loading:started`);

		await plugin.init({ config, channel, appConfig, logger: this._logger });
		await plugin.load(channel);

		channel.publish(`${name}:loading:finished`);

		this._inMemoryPlugins[name] = { plugin, channel };

		this._logger.info(name, 'Loaded in-memory plugin');
	}

	private async _loadChildProcessPlugin(
		plugin: BasePlugin,
		config: PluginConfig,
		appConfig: ApplicationConfigForPlugin,
	): Promise<void> {
		const { name } = plugin;

		this._logger.info(name, 'Loading child-process plugin');
		const program = path.resolve(__dirname, 'child_process_loader');
		const parameters = [getPluginExportPath(plugin) as string, plugin.constructor.name];

		// Avoid child processes and the main process sharing the same debugging ports causing a conflict
		const forkedProcessOptions: { execArgv: string[] | undefined } = {
			execArgv: undefined,
		};
		const maxPort = 20000;
		const minPort = 10000;
		if (process.env.NODE_DEBUG) {
			forkedProcessOptions.execArgv = [
				`--inspect=${Math.floor(Math.random() * (maxPort - minPort) + minPort)}`,
			];
		}

		const child = childProcess.fork(program, parameters, forkedProcessOptions);

		child.send({
			action: 'load',
			config,
			appConfig,
			ipcConfig: this._config,
		});

		this._childProcesses[name] = child;

		child.on('exit', (code, signal) => {
			// If child process exited with error
			if (code !== null && code !== undefined && code !== 0) {
				this._logger.error({ name, code, signal: signal ?? '' }, 'Child process plugin exited');
			}
		});

		child.on('error', error => {
			this._logger.error(error, `Child process for "${name}" faced error.`);
		});

		await Promise.race([
			new Promise<void>(resolve => {
				this.channel.once(`${name}:loading:finished`, () => {
					this._logger.info({ name }, 'Loaded child-process plugin');
					resolve();
				});
			}),
			new Promise((_, reject) => {
				setTimeout(() => {
					reject(new Error('Child process plugin loading timeout'));
				}, 2000);
			}),
		]);
	}

	private async _unloadInMemoryPlugin(name: string): Promise<void> {
		this._inMemoryPlugins[name].channel.publish(`${name}:unloading:started`);
		try {
			await this._inMemoryPlugins[name].plugin.unload();
			this._inMemoryPlugins[name].channel.publish(`${name}:unloading:finished`);
		} catch (error) {
			this._inMemoryPlugins[name].channel.publish(`${name}:unloading:error`, error);
		} finally {
			delete this._inMemoryPlugins[name];
		}
	}

	private async _unloadChildProcessPlugin(name: string): Promise<void> {
		if (!this._childProcesses[name].connected) {
			this._childProcesses[name].kill('SIGTERM');
			delete this._childProcesses[name];
			throw new Error('Child process is not connected any more.');
		}

		this._childProcesses[name].send({
			action: 'unload',
		});

		await Promise.race([
			new Promise<void>(resolve => {
				this.channel.once(`${name}:unloading:finished`, () => {
					this._logger.info(`Child process plugin "${name}" unloaded`);
					delete this._childProcesses[name];
					resolve();
				});
			}),
			new Promise((_, reject) => {
				this.channel.once(`${name}:unloading:error`, data => {
					this._logger.info(`Child process plugin "${name}" unloaded with error`);
					this._logger.error(data ?? {}, 'Unloading plugin error.');
					delete this._childProcesses[name];
					reject(data);
				});
			}),
			new Promise((_, reject) => {
				setTimeout(() => {
					this._childProcesses[name].kill('SIGTERM');
					delete this._childProcesses[name];
					reject(new Error('Child process plugin unload timeout'));
				}, 2000);
			}),
		]);
	}
}
