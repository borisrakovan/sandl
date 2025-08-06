import util from 'util';

/**
 * Custom class for secret objects that masks the value when logged or stringified.
 */
export class SecretValue<T> {
	// Use private class field to store the secret value
	readonly #secret: T;

	constructor(secret: T) {
		this.#secret = secret;
	}

	// Override toString to mask the secret when logged
	toString() {
		return '***SECRET***';
	}

	// Override toJSON for JSON.stringify to mask the secret
	toJSON() {
		return '***SECRET***';
	}

	// Method to return the actual value when needed
	value(): T {
		return this.#secret;
	}

	// Implement custom inspect method to mask secret when console.log is used
	[util.inspect.custom]() {
		return '***SECRET***';
	}
}
