export type JsonObject = { [key: string]: JsonValue };
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| Date
	| JsonObject
	| JsonValue[];

export type PromiseOrValue<T> = T | Promise<T>;

/**
 * Generic interface representing a class constructor.
 *
 * This is primarily used internally for type constraints and validations.
 * Most users should use Tag.Class() instead of working with raw constructors.
 *
 * @template T - The type that the constructor creates
 * @internal
 */
export interface ClassConstructor<T = unknown> {
	readonly name: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new (...args: any[]): T;
}
