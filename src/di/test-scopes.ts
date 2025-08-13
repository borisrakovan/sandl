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

	// Create containers and register services - register in proper order to maintain types
	const runtimeContainer = scopedContainer('runtime')
		// Register ServiceA in runtime scope
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
		);

	// Create a request-scoped child container and register ServiceB
	const requestContainer = runtimeContainer
		.child('request')
		// Register ServiceB in request scope (per-request instance)
		.register(
			ServiceB,
			async (c) => {
				console.log('Creating ServiceB in request scope');
				const serviceA = await c.get(ServiceA); // This will come from runtime scope
				return new ServiceB(serviceA);
			},
			(_serviceB) => {
				console.log('Finalizing ServiceB in request scope');
				return Promise.resolve();
			}
			// No scope parameter = current scope (request)
		);

	console.log('--- Getting ServiceA from request container ---');
	const serviceA = await requestContainer.get(ServiceA);
	serviceA.do2();

	console.log('\n--- Getting ServiceB from request container ---');
	const serviceB = await requestContainer.get(ServiceB);
	serviceB.do();

	console.log(
		'\n--- Runtime container only has ServiceA (ServiceB is request-scoped) ---'
	);
	console.log(
		'Runtime container has ServiceA:',
		runtimeContainer.has(ServiceA)
	);
	// Note: ServiceB is only available in request scope, not runtime scope

	console.log('\n--- Checking has() method ---');
	console.log(
		'Request container has ServiceA:',
		requestContainer.has(ServiceA)
	);
	console.log(
		'Request container has ServiceB:',
		requestContainer.has(ServiceB)
	);
	console.log(
		'Runtime container has ServiceA:',
		runtimeContainer.has(ServiceA)
	);
	console.log(
		'Runtime container has ServiceB:',
		runtimeContainer.has(ServiceB)
	);

	console.log(
		'\n--- Cleaning up (notice destroy order: child first, then parent) ---'
	);
	await runtimeContainer.destroy(); // This will destroy children first, then parent
	console.log('All containers destroyed');

	console.log('\n--- Testing cross-scope sharing ---');
	// Create another request container to show ServiceA is shared across scopes
	const requestContainer2 = runtimeContainer.child('request-2');

	console.log('Getting ServiceA from second request container...');
	const serviceA2 = await requestContainer2.get(ServiceA);
	console.log('ServiceA instances are the same:', serviceA === serviceA2);

	console.log('\n--- Testing container reusability ---');
	console.log('Container should still be usable after destroy...');

	// Container should be reusable - can create new instances after destroy
	const newServiceA = await runtimeContainer.get(ServiceA);
	newServiceA.do2();

	// Create a new request container and register ServiceB again (since it's request-scoped)
	const newRequestContainer = runtimeContainer
		.child('request-3')
		.register(ServiceB, async (c) => {
			console.log('Creating ServiceB in new request scope');
			const serviceA = await c.get(ServiceA);
			return new ServiceB(serviceA);
		});

	const newServiceB = await newRequestContainer.get(ServiceB);
	newServiceB.do();

	console.log('✓ Container successfully reused after destruction!');
}

main().catch(console.error);
