/**
 * Splits an array into batches of specified size.
 *
 * @param items Array to split into batches
 * @param batchSize Maximum size of each batch
 * @returns Array of batches
 * @throws Error if batchSize is less than 1
 *
 * @example
 * const items = [1, 2, 3, 4, 5];
 * const batches = makeBatches(items, 2);
 * // Result: [[1, 2], [3, 4], [5]]
 */
export function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
	if (batchSize < 1) {
		throw new Error(`Batch size must be at least 1, received ${batchSize}`);
	}

	const batches: T[][] = [];
	for (let i = 0; i < items.length; i += batchSize) {
		batches.push(items.slice(i, i + batchSize));
	}
	return batches;
}

type Grouped<T, K extends PropertyKey> = Record<K, T[]>;

/**
 * A type-safe `groupBy` function that groups items in an array based on a key derived from a callback.
 * @param array - The array to group.
 * @param keySelector - A function that selects the key for grouping.
 * @returns An object where keys are derived from the `keySelector` and values are arrays of grouped items.
 */
export function groupBy<T, K extends PropertyKey>(
	array: T[],
	keySelector: (item: T) => K
): Grouped<T, K> {
	return array.reduce(
		(acc, item) => {
			const key = keySelector(item);
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			(acc[key] ??= []).push(item);
			return acc;
		},
		{} as Grouped<T, K>
	);
}
