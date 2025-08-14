import { IContainer } from './di/container.js';
import { container, Tag } from './index.js';

class StatusService extends Tag.Class('StatusService') {}

// This should produce a type error but might not due to variance issues
const test: IContainer<typeof StatusService> = container();

// Let's test what happens when we try to use it
async function testUsage() {
	// This SHOULD fail at runtime since StatusService is not registered
	try {
		const status = await test.get(StatusService);
		console.log('Got status:', status); // This should never execute
	} catch (err) {
		console.log('Expected error:', err);
	}
}

export { test, testUsage };
