import { DPoSModule } from '../../../../src/modules/dpos_v2/module';

describe('DPoSModule', () => {
	let dposModule: DPoSModule;
	beforeEach(() => {
		dposModule = new DPoSModule();
	});

	describe('module', () => {
		describe('init', () => {
			it.todo('should moduleConfig have correct values');
		});
	});

	describe('afterBlockExecute', () => {
		let randomAPI: any;
		let bftAPI: any;
		let validatorsAPI: any;
		let tokenAPI: any;
		beforeEach(() => {
			randomAPI = {
				getRandomBytes: jest.fn(),
			};
			bftAPI = {
				getBFTParameters: jest.fn(),
				setBFTParameters: jest.fn(),
			};
			validatorsAPI = {};
			tokenAPI = {};

			dposModule.addDependencies(randomAPI, bftAPI, validatorsAPI, tokenAPI);
		});

		it.todo('should increase missed blocks for block missing delegates');
		it.todo('should stall missed blocks for block forging delegates'); // Some missed blocks are already existing, they will stall
		it.todo('should ban delegates for missing too much blocks');
		it.todo(
			'should reset consecutiveMissedBlocks and lastGeneratedHeight for generator after successful forging',
		);
		it.todo(
			'should not set consecutiveMissedBlocks and lastGeneratedHeight for generator after missing block',
		);
		it.todo('should set previousTimestamp after successful forging');
		it.todo('should not set previousTimestamp after missed block');
		it.todo('should set last 3 snapshots to snapshotStore');
		it.todo('should set bft parameters correctly');
		it.todo('should throw error when cannot pick a standby delegate');
		it.todo('should set correct generators');
	});
});
