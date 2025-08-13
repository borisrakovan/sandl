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

async function main() {
	console.log('Testing ScopedDependencyContainer...\n');

	// Create a runtime-scoped container with finalizers
	const runtimeContainer = scopedContainer('runtime')
		.register(
			ServiceA, 
			() => {
				console.log('Creating ServiceA in runtime scope');
				return new ServiceA();
			},
			(_serviceA) => {
				console.log('Finalizing ServiceA in runtime scope');
				return Promise.resolve();
			}
		)
		.register(
			ServiceB, 
			async (c) => {
				console.log('Creating ServiceB in runtime scope');
				return new ServiceB(await c.get(ServiceA));
			},
			(_serviceB) => {
				console.log('Finalizing ServiceB in runtime scope');
				return Promise.resolve();
			}
		);

	// Create a request-scoped child container
	const requestContainer = runtimeContainer
		.child('request')
		.register(
			ServiceB, 
			async (c) => {
				console.log('Creating ServiceB in request scope (overriding runtime)');
				const serviceA = await c.get(ServiceA); // This will come from runtime scope
				return new ServiceB(serviceA);
			},
			(_serviceB) => {
				console.log('Finalizing ServiceB in request scope');
				return Promise.resolve();
			}
		);

	console.log('--- Getting ServiceA from request container ---');
	const serviceA = await requestContainer.get(ServiceA);
	serviceA.do2();

	console.log('\n--- Getting ServiceB from request container ---');
	const serviceB = await requestContainer.get(ServiceB);
	serviceB.do();

	console.log('\n--- Getting ServiceB from runtime container ---');
	const runtimeServiceB = await runtimeContainer.get(ServiceB);
	runtimeServiceB.do();

	console.log('\n--- Checking has() method ---');
	console.log('Request container has ServiceA:', requestContainer.has(ServiceA));
	console.log('Request container has ServiceB:', requestContainer.has(ServiceB));
	console.log('Runtime container has ServiceA:', runtimeContainer.has(ServiceA));
	console.log('Runtime container has ServiceB:', runtimeContainer.has(ServiceB));

	console.log('\n--- Cleaning up (notice destroy order: child first, then parent) ---');
	await runtimeContainer.destroy(); // This will destroy children first, then parent
	console.log('All containers destroyed');

	console.log('\n--- Testing container reusability ---');
	console.log('Container should still be usable after destroy...');
	
	// Container should be reusable - can create new instances after destroy
	const newServiceA = await runtimeContainer.get(ServiceA);
	newServiceA.do2();
	
	const newRequestContainer = runtimeContainer.child('request-2');
	const newServiceB = await newRequestContainer.get(ServiceB);
	newServiceB.do();
	
	console.log('✓ Container successfully reused after destruction!');
}

main().catch(console.error);
