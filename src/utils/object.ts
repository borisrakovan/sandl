export const isDefined = <T>(value: T | undefined | null): value is T =>
	value !== undefined && value !== null;

export function hasKey<T extends PropertyKey>(
	obj: unknown,
	key: T
): obj is Record<T, unknown> {
	return (
		obj !== undefined &&
		obj !== null &&
		(typeof obj === 'object' || typeof obj === 'function') &&
		key in obj
	);
}

export function getKey(obj: unknown, ...keys: PropertyKey[]): unknown {
	let current = obj;
	for (const key of keys) {
		if (!hasKey(current, key)) {
			return undefined;
		}
		current = current[key];
	}
	return current;
}

export function getKeyOrThrow(obj: unknown, ...keys: PropertyKey[]): unknown {
	const value = getKey(obj, ...keys);
	if (value === undefined) {
		throw new Error(`Key not found: ${keys.join('.')}`);
	}
	return value;
}

export function isObject(
	value: unknown
): value is Record<PropertyKey, unknown> {
	return typeof value === 'object' && value !== null;
}

export function deleteKeys<T extends object, K extends keyof T>(
	obj: T,
	...keys: K[]
): Omit<T, K> {
	const copy = { ...obj };
	const result = Object.fromEntries(
		Object.entries(copy).filter(([key]) => !keys.includes(key as K))
	);
	return result as Omit<T, K>;
}

/**
 * Performs a deep equality comparison between two values.
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns true if the values are deeply equal, false otherwise
 */
export function isDeepEqual<T>(a: T, b: T): boolean {
	if (a === b) return true;

	if (a === null || b === null) return a === b;
	if (typeof a !== 'object' || typeof b !== 'object') return a === b;

	const aArray = Array.isArray(a);
	const bArray = Array.isArray(b);

	if (aArray !== bArray) return false;

	if (aArray) {
		if (a.length !== (b as unknown[]).length) return false;
		return a.every((item, index) =>
			isDeepEqual(item, (b as unknown[])[index])
		);
	}

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);

	if (aKeys.length !== bKeys.length) return false;

	return aKeys.every(
		(key) =>
			Object.prototype.hasOwnProperty.call(b, key) &&
			isDeepEqual(
				(a as Record<string, unknown>)[key],
				(b as Record<string, unknown>)[key]
			)
	);
}
