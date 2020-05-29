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
/* eslint-disable no-bitwise */
/* eslint-disable @typescript-eslint/prefer-for-of */

import { hash } from '@liskhq/lisk-cryptography';
import { Proof } from './types';
import { EMPTY_HASH, LEAF_PREFIX, BRANCH_PREFIX } from './constants';

const LAYER_INDEX_SIZE = 1;
const NODE_INDEX_SIZE = 8;
const NODE_HASH_SIZE = 32;

enum NodeType {
	ROOT = 'root',
	BRANCH = 'branch',
	LEAF = 'leaf',
}

interface NodeData {
	readonly value: Buffer;
	readonly hash: Buffer;
}

interface NodeInfo {
	readonly type: NodeType;
	readonly hash: Buffer;
	readonly value: Buffer;
	readonly leftHash: Buffer;
	readonly rightHash: Buffer;
	readonly layerIndex: number;
	readonly nodeIndex: bigint;
}

const isLeaf = (value: Buffer): boolean => 
	LEAF_PREFIX.compare(value.slice(0, 1)) === 0 && value.compare(Buffer.alloc(0)) !== 0;

const isAppendPath = (dataLength: number, layer: number) => {
	const multiplier = 2 ** (layer - 1);
	return ((dataLength | (multiplier - 1)) & multiplier) !== 0;
};

export class MerkleTree {
	private _root: Buffer;
	private _width = 0;

	// Object holds data in format { [hash]: value }
	private _hashToBuffer: { [key: string]: Buffer } = {};

	public constructor(initValues: Buffer[] = []) {
		this._width = initValues.length;
		if (this._width === 0) {
			this._root = EMPTY_HASH;
			return;
		}

		this._root = this._build(initValues);
	}

	public get root(): Buffer {
		return this._root;
	}

	public getNode(hash: Buffer): NodeInfo {
		const value = this._hashToBuffer[hash.toString('binary')];
		if(!value) {
			throw new Error(`Hash does not exist in merkle tree.: ${hash}`)
		}
		const type = this._root.compare(hash) === 0 ? NodeType.ROOT : isLeaf(value) ? NodeType.LEAF : NodeType.BRANCH;
		const layerIndex = type === NodeType.BRANCH ? value.readInt8(0) : 0;
		const nodeIndex =  type === NodeType.BRANCH ? value.readBigInt64BE(
			LAYER_INDEX_SIZE,
		) :BigInt(0);
		const rightHash = type !== NodeType.LEAF ? value.slice(-1 * NODE_HASH_SIZE): Buffer.alloc(0);
		const leftHash =  type !== NodeType.LEAF ? value.slice(-2 * NODE_HASH_SIZE, -1 * NODE_HASH_SIZE): Buffer.alloc(0);
		
		return {
			type,
			hash,
			value,
			layerIndex,
			nodeIndex,
			rightHash,
			leftHash,
		};
	};

	public append(value: Buffer): Buffer {
		const appendPath: NodeInfo[] = [];
		const appendData = this._generateLeaf(value);
		const appendNode = this.getNode(appendData.hash)
		const rootNodeHash = this.root;
		let currentNode = this.getNode(rootNodeHash);
		const treeHeight =  this._getHeight();
		// const binaryDataLength = .toString(2);
		for (let i = 0; i < treeHeight; i++) {
			if (isAppendPath(this._width - 1, treeHeight - i)) { 
				appendPath.push(currentNode);
			}

			if (isLeaf(currentNode.hash)){ 
				break;
			}

			if (isAppendPath(this._width -1, treeHeight - i - 1)) { 
				appendPath.push(this.getNode(currentNode.leftHash));
			}

			if(currentNode.rightHash) {
				break;
			}

			if(isLeaf(currentNode.rightHash) || Buffer.alloc(0).compare(currentNode.rightHash) === 0) {
				break;
			}
			currentNode = this.getNode(currentNode.rightHash);
		}

		appendPath.push(this.getNode(appendNode.hash));

		// Generate any new branch nodes and store to memory
		while(appendPath.length > 1) {
			const rightNodeInfo = appendPath.pop();
			const leftNodeInfo = appendPath.pop();
			// FIXME: Add correct nodeIndex:  get left node nodex index + 1
			const newNode = this._generateNode((leftNodeInfo as NodeInfo).hash, (rightNodeInfo as NodeInfo).hash, (leftNodeInfo as NodeInfo).layerIndex + 1, (leftNodeInfo as NodeInfo).nodeIndex + BigInt(1));
			this._hashToBuffer[newNode.hash.toString('binary')] = newNode.value;
			appendPath.push(this.getNode(newNode.hash));
		}
		// eslint-disable-next-line prefer-destructuring
		this._root = appendPath[0].hash;

		return this.root;
	}

	// eslint-disable-next-line
	public generateProof(_queryData: ReadonlyArray<Buffer>): Proof {
		// eslint-disable-next-line
		return {} as any;
	}

	public clear(): void {
		this._width = 0;
		this._hashToBuffer = {};
		this._root = EMPTY_HASH;
	}

	public toString(): string {
		if (this._width === 0) {
			return this.root.toString('hex');
		}
		return this._printNode(this.root);
	}

	private _getHeight(): number {
		return Math.ceil(Math.log2(this._width)) + 1;
	}

	private _generateLeaf(value: Buffer): NodeData {
		const leafValue = Buffer.concat(
			[LEAF_PREFIX, value],
				LEAF_PREFIX.length + 
				value.length
		);
		const leafHash = hash(leafValue);
		
		this._hashToBuffer[leafHash.toString('binary')] = leafValue;
		this._width += 1;

		return {
			value: leafValue,
			hash: hash(leafValue),
		};
	};

	private _generateNode(
		leftHashBuffer: Buffer,
		rightHashBuffer: Buffer,
		layerIndex: number,
		nodeIndex: bigint,
	): NodeData {
		const layerIndexBuffer = Buffer.alloc(LAYER_INDEX_SIZE);
		const nodeIndexBuffer = Buffer.alloc(NODE_INDEX_SIZE);
		layerIndexBuffer.writeInt8(layerIndex, 0);
		nodeIndexBuffer.writeBigInt64BE(nodeIndex, 0);

		const branchValue = Buffer.concat(
			[BRANCH_PREFIX, layerIndexBuffer, nodeIndexBuffer, leftHashBuffer, rightHashBuffer],
			     BRANCH_PREFIX.length +
				layerIndexBuffer.length +
				nodeIndexBuffer.length +
				leftHashBuffer.length +
				rightHashBuffer.length,
		);
		const branchHash = hash(
			Buffer.concat(
				[BRANCH_PREFIX, leftHashBuffer, rightHashBuffer],
				BRANCH_PREFIX.length + leftHashBuffer.length + rightHashBuffer.length,
			),
		);		
		this._hashToBuffer[branchHash.toString('binary')] = branchValue;

		return {
			hash: branchHash,
			value: branchValue,
		};
	};

	private _build(initValues: Buffer[]): Buffer {
		// Generate hash and buffer of leaves and store in memory
		const leafHashes = [];
		for (let i = 0; i < initValues.length; i += 1) {
			const leaf = this._generateLeaf(initValues[i]);

			leafHashes.push(leaf.hash);
			this._hashToBuffer[leaf.hash.toString('binary')] = leaf.value;
		}

		// Start from base layer
		let currentLayerNodes = leafHashes;
		let orphanNodeInPreviousLayer: Buffer | undefined;
		let currentLayer = 0;
		// Loop through each layer as long as there are nodes or an orphan node from previous layer
		while (
			currentLayerNodes.length > 1 ||
			orphanNodeInPreviousLayer !== undefined
		) {
			const pairs: Array<[Buffer, Buffer]> = [];

			// Make pairs from the current layer nodes
			for (let i = 0; i < currentLayerNodes.length - 1; i += 2) {
				pairs.push([currentLayerNodes[i], currentLayerNodes[i + 1]]);
			}

			// If there is one node left from pairs
			if (currentLayerNodes.length % 2 === 1) {
				// If no orphan node left from previous layer, set the last node to new orphan node
				if (orphanNodeInPreviousLayer === undefined) {
					orphanNodeInPreviousLayer =
						currentLayerNodes[currentLayerNodes.length - 1];

					// If one orphan node left from previous layer then pair with last node
				} else {
					pairs.push([
						currentLayerNodes[currentLayerNodes.length - 1],
						orphanNodeInPreviousLayer,
					]);
					orphanNodeInPreviousLayer = undefined;
				}
			}

			// Generate hash and buffer for the parent layer and store
			const parentLayerNodes = [];
			for (let i = 0; i < pairs.length; i += 1) {
				const left = pairs[i][0];
				const right = pairs[i][1];
				const node = this._generateNode(left, right, currentLayer, BigInt(i));
				this._hashToBuffer[node.hash.toString('binary')] = node.value;

				parentLayerNodes.push(node.hash);
			}

			// Set current layer to parent layer
			currentLayerNodes = parentLayerNodes;
			currentLayer += 1;
		}

		return currentLayerNodes[0];
	}

	private _printNode(hashValue: Buffer, level = 1): string {
		const nodeValue = this._hashToBuffer[hashValue.toString('binary')];

		if (isLeaf(nodeValue)) {
			return nodeValue.toString('hex');
		}

		const node = this.getNode(nodeValue);

		return [
			hashValue.toString('hex'),
			`├${'─'.repeat(level)} ${this._printNode(node.left, level + 1)}`,
			`├${'─'.repeat(level)} ${this._printNode(node.right, level + 1)}`,
		].join('\n');
	}
}
