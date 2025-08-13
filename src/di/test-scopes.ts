import { scopedContainer } from './container.js';
import { Tag } from './tag.js';

export class ServiceA extends Tag.Class('ServiceA') {
	do() {
		console.log('ServiceA.do');
	}

	do2() {
		console.log('ServiceA.do2');
	}
}

class ServiceB extends Tag.Class('ServiceB') {
	constructor(private readonly serviceA: ServiceA) {
		super();
	}
	do() {
		this.serviceA.do();
		console.log('ServiceB.do');
	}
}

class _Database {
	constructor(private readonly name: string) {}
}

class _Config {
	constructor(private readonly someValue: string) {}
}

const _ProductDatabase = Tag.of('ProductDatabase')<_Database>();

const _OrderDatabase = Tag.of('OrderDatabase')();

function main() {
	// const c = new BasicDependencyContainer();

	const _runtimeContainer = scopedContainer('runtime')
		.register(ServiceA, () => new ServiceA())
		.register(ServiceB, async (c) => new ServiceB(await c.get(ServiceA)));

	// const requestContainer = runtimeContainer
	// 	.child('request')
	// 	.register(ServiceB, async (c) => c);

	// const serviceA = await requestContainer.get(ServiceA);
	//
	// serviceA.do2();
}

main();
