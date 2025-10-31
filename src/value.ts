import type { Layer } from './layer.js';
import { layer } from './layer.js';
import type { ValueTag } from './tag.js';

/**
 * Creates a layer that provides a constant value for a given tag.
 *
 * @param tag - The value tag to provide
 * @param constantValue - The constant value to provide
 * @returns A layer with no dependencies that provides the constant value
 *
 * @example
 * ```typescript
 * const ApiKey = Tag.of('ApiKey')<string>();
 * const DatabaseUrl = Tag.of('DatabaseUrl')<string>();
 *
 * const apiKey = value(ApiKey, 'my-secret-key');
 * const dbUrl = value(DatabaseUrl, 'postgresql://localhost:5432/myapp');
 *
 * const config = Layer.merge(apiKey, dbUrl);
 * ```
 */
export function value<Id extends string | symbol, T>(
	tag: ValueTag<Id, T>,
	constantValue: T
): Layer<never, ValueTag<Id, T>> {
	return layer<never, ValueTag<Id, T>>((container) =>
		container.register(tag, () => constantValue)
	);
}
