import { JsonValue } from '@/types.js';

/**
 * Type-safe version of JSON.parse
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function jsonParse<T = JsonValue>(input: string): T {
	return JSON.parse(input) as T;
}

/**
 * Type-safe version of JSON.stringify
 */
export function jsonStringify(
	value: JsonValue,
	replacer: Parameters<typeof JSON.stringify>[1] = undefined,
	space?: Parameters<typeof JSON.stringify>[2]
): string {
	return JSON.stringify(value, replacer, space);
}
