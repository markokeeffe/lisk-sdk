/* eslint-disable class-methods-use-this */

import {
    BaseModule,
    ModuleInitArgs,
    BlockGenerateContext,
	BlockVerifyContext,
	TransactionVerifyContext,
	VerificationResult,
	TransactionExecuteContext,
	GenesisBlockExecuteContext,
	BlockExecuteContext,
	BlockAfterExecuteContext,
} from 'lisk-sdk';
import { <%= moduleClass %>Endpoint } from './endpoint';
import { <%= moduleClass %>API } from './api';

export class <%= moduleClass %> extends BaseModule {
    public endpoint = new <%= moduleClass %>Endpoint();
    public api = new <%= moduleClass %>API();
    public name = '<%= moduleName %>';
    public transactionAssets = [];
    public events = [
        // Example below
        // '<%= moduleName %>:newBlock',
    ];
    public id = <%= moduleID %>;

    // Lifecycle hooks
    public async init(_args: ModuleInitArgs): Promise<void> {
		// initialize this module when starting a node
	}

	public async initBlock(_context: BlockGenerateContext): Promise<void> {
		// initialize block generation, add asset
	}
	public async sealBlock(_context: BlockGenerateContext): Promise<void> {
		// finalize block asset
	}
	public async verifyBlock(_context: BlockVerifyContext): Promise<void> {
		// verify block
	}

    // Lifecycle hooks
	public async verifyTransaction(_context: TransactionVerifyContext): Promise<VerificationResult> {
		// verify transaction will be called multiple times in the transaction pool

	}

	public async beforeTransactionExecute(_context: TransactionExecuteContext): Promise<void> {
	}

	public async afterTransactionExecute(_context: TransactionExecuteContext): Promise<void> {

	}
	public async afterGenesisBlockExecute(_context: GenesisBlockExecuteContext): Promise<void> {

	}

	public async beforeBlockExecute(_context: BlockExecuteContext): Promise<void> {

	}

	public async afterBlockExecute(_context: BlockAfterExecuteContext): Promise<void> {

	}
}
