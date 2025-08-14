import { IContainer } from './container.js';
import { AnyTag } from './tag.js';
import { Scope } from './types.js';

/**
 * A dependency layer represents a reusable, composable unit of dependency registrations.
 * Layers allow you to organize your dependency injection setup into logical groups
 * that can be combined and reused across different contexts.
 *
 * @template TRequires - The union of tags this layer requires to be satisfied by other layers
 * @template TProvides - The union of tags this layer provides/registers
 *
 * @example Basic layer usage
 * ```typescript
 * import { layer, Tag } from '@/di/layer.js';
 * import { container } from '@/di/container.js';
 *
 * class DatabaseService extends Tag.Class('DatabaseService') {
 *   query() { return 'data'; }
 * }
 *
 * // Create a layer that provides DatabaseService
 * const databaseLayer = layer<never, typeof DatabaseService>((container) =>
 *   container.register(DatabaseService, () => new DatabaseService())
 * );
 *
 * // Apply the layer to a container
 * const c = container();
 * const finalContainer = databaseLayer().register(c);
 *
 * const db = await finalContainer.get(DatabaseService);
 * ```
 *
 * @example Layer composition
 * ```typescript
 * // Layer that requires DatabaseService and provides UserService
 * const userLayer = layer<typeof DatabaseService, typeof UserService>((container) =>
 *   container.register(UserService, async (c) =>
 *     new UserService(await c.get(DatabaseService))
 *   )
 * );
 *
 * // Compose layers: database layer provides what user layer needs
 * const appLayer = databaseLayer().to(userLayer());
 * ```
 */
export interface Layer<
	TRequires extends AnyTag = never,
	TProvides extends AnyTag = never,
> {
	/**
	 * Applies this layer's registrations to the given container.
	 *
	 * @param container - The container to register dependencies into
	 * @returns A new container with this layer's dependencies registered
	 *
	 * @example
	 * ```typescript
	 * const container = container();
	 * const updatedContainer = myLayer.register(container);
	 * ```
	 */
	register: <TScope extends Scope>(
		container: IContainer<TRequires, TScope>
	) => IContainer<TRequires | TProvides, TScope>;

	/**
	 * Composes this layer with a target layer, creating a pipeline where this layer's
	 * provisions satisfy the target layer's requirements. This creates a dependency
	 * flow from source → target.
	 *
	 * Type-safe: The target layer's requirements must be satisfiable by this layer's
	 * provisions and any remaining external requirements.
	 *
	 * @template TTargetRequires - What the target layer requires
	 * @template TTargetProvides - What the target layer provides
	 * @param target - The layer to compose with
	 * @returns A new composed layer
	 *
	 * @example Simple composition
	 * ```typescript
	 * const configLayer = layer<never, typeof ConfigTag>(...);
	 * const dbLayer = layer<typeof ConfigTag, typeof DatabaseService>(...);
	 *
	 * // Config provides what database needs
	 * const infraLayer = configLayer().to(dbLayer());
	 * ```
	 *
	 * @example Multi-level composition
	 * ```typescript
	 * const appLayer = configLayer()
	 *   .to(databaseLayer())
	 *   .to(serviceLayer())
	 *   .to(apiLayer());
	 * ```
	 */
	to: <TTargetRequires extends AnyTag, TTargetProvides extends AnyTag>(
		target: Layer<TTargetRequires, TTargetProvides>
	) => Layer<
		TRequires | Exclude<TTargetRequires, TProvides>,
		TProvides | TTargetProvides
	>;

	/**
	 * Merges this layer with another layer, combining their requirements and provisions.
	 * This is useful for combining independent layers that don't have a dependency
	 * relationship.
	 *
	 * @template TOtherRequires - What the other layer requires
	 * @template TOtherProvides - What the other layer provides
	 * @param other - The layer to merge with
	 * @returns A new merged layer requiring both layers' requirements and providing both layers' provisions
	 *
	 * @example Merging independent layers
	 * ```typescript
	 * const persistenceLayer = layer<never, typeof DatabaseService | typeof CacheService>(...);
	 * const loggingLayer = layer<never, typeof LoggerService>(...);
	 *
	 * // Combine infrastructure layers
	 * const infraLayer = persistenceLayer().and(loggingLayer());
	 * ```
	 *
	 * @example Building complex layer combinations
	 * ```typescript
	 * const appInfraLayer = persistenceLayer()
	 *   .and(messagingLayer())
	 *   .and(observabilityLayer());
	 * ```
	 */
	and: <TOtherRequires extends AnyTag, TOtherProvides extends AnyTag>(
		other: Layer<TOtherRequires, TOtherProvides>
	) => Layer<TRequires | TOtherRequires, TProvides | TOtherProvides>;
}

/**
 * A factory function for creating layers.
 *
 * @template TRequires - The union of tags this layer requires
 * @template TProvides - The union of tags this layer provides
 * @template TParams - Optional parameters that can be passed to configure the layer
 */
export type LayerFactory<
	TRequires extends AnyTag,
	TProvides extends AnyTag,
	TParams = undefined,
> = TParams extends undefined
	? () => Layer<TRequires, TProvides>
	: (params: TParams) => Layer<TRequires, TProvides>;

/**
 * Creates a new dependency layer that encapsulates a set of dependency registrations.
 * Layers are the primary building blocks for organizing and composing dependency injection setups.
 *
 * @template TRequires - The union of dependency tags this layer requires from other layers or external setup
 * @template TProvides - The union of dependency tags this layer registers/provides
 * @template TParams - Optional parameters that can be passed to configure the layer
 *
 * @param register - Function that performs the dependency registrations. Receives a container and optional params.
 * @returns A layer factory function. If TParams is undefined, returns a parameterless function. Otherwise returns a function that takes TParams.
 *
 * @example Simple layer without parameters
 * ```typescript
 * import { layer, Tag } from '@/di/layer.js';
 *
 * class DatabaseService extends Tag.Class('DatabaseService') {
 *   constructor(private url: string = 'sqlite://memory') {}
 *   query() { return 'data'; }
 * }
 *
 * // Layer that provides DatabaseService, requires nothing
 * const databaseLayer = layer<never, typeof DatabaseService>((container) =>
 *   container.register(DatabaseService, () => new DatabaseService())
 * );
 *
 * // Usage
 * const dbLayerInstance = databaseLayer(); // No parameters needed
 * ```
 *
 * @example Layer with dependencies
 * ```typescript
 * const ConfigTag = Tag.of('config')<{ dbUrl: string }>();
 *
 * // Layer that requires ConfigTag and provides DatabaseService
 * const databaseLayer = layer<typeof ConfigTag, typeof DatabaseService>((container) =>
 *   container.register(DatabaseService, async (c) => {
 *     const config = await c.get(ConfigTag);
 *     return new DatabaseService(config.dbUrl);
 *   })
 * );
 * ```
 *
 * @example Parameterized layer
 * ```typescript
 * interface DatabaseConfig {
 *   host: string;
 *   port: number;
 * }
 *
 * // Layer that takes configuration parameters
 * const databaseLayer = layer<never, typeof DatabaseService, DatabaseConfig>(
 *   (container, config) =>
 *     container.register(DatabaseService, () => new DatabaseService(config))
 * );
 *
 * // Usage with parameters
 * const dbLayerInstance = databaseLayer({ host: 'localhost', port: 5432 });
 * ```
 *
 * @example Complex application layer structure
 * ```typescript
 * // Configuration layer
 * const configLayer = layer<never, typeof ConfigTag>((container) =>
 *   container.register(ConfigTag, () => loadConfig())
 * );
 *
 * // Infrastructure layer (requires config)
 * const infraLayer = layer<typeof ConfigTag, typeof DatabaseService | typeof CacheService>(
 *   (container) =>
 *     container
 *       .register(DatabaseService, async (c) => new DatabaseService(await c.get(ConfigTag)))
 *       .register(CacheService, async (c) => new CacheService(await c.get(ConfigTag)))
 * );
 *
 * // Service layer (requires infrastructure)
 * const serviceLayer = layer<typeof DatabaseService | typeof CacheService, typeof UserService>(
 *   (container) =>
 *     container.register(UserService, async (c) =>
 *       new UserService(await c.get(DatabaseService), await c.get(CacheService))
 *     )
 * );
 *
 * // Compose the complete application
 * const appLayer = configLayer().to(infraLayer()).to(serviceLayer());
 * ```
 */
export function layer<
	TRequires extends AnyTag = never,
	TProvides extends AnyTag = never,
	TParams = undefined,
>(
	register: <TScope extends Scope>(
		container: IContainer<TRequires, TScope>,
		params: TParams
	) => IContainer<TRequires | TProvides, TScope>
): LayerFactory<TRequires, TProvides, TParams> {
	const factory = (params?: TParams) => {
		const layerImpl: Layer<TRequires, TProvides> = {
			register: (container) => register(container, params as TParams),
			to(target) {
				return createComposedLayer(layerImpl, target);
			},
			and(other) {
				return createMergedLayer(layerImpl, other);
			},
		};
		return layerImpl;
	};
	return factory as LayerFactory<TRequires, TProvides, TParams>;
}

/**
 * Internal function to create a composed layer from two layers.
 * This implements the `.to()` method logic.
 *
 * @internal
 */
function createComposedLayer<
	TRequires1 extends AnyTag,
	TProvides1 extends AnyTag,
	TRequires2 extends AnyTag,
	TProvides2 extends AnyTag,
>(
	source: Layer<TRequires1, TProvides1>,
	target: Layer<TRequires2, TProvides2>
): Layer<
	TRequires1 | Exclude<TRequires2, TProvides1>,
	TProvides1 | TProvides2
> {
	return layer((container) => {
		const containerWithSource = source.register(container);
		return target.register(
			// Type assertion needed due to contravariance - composition is safe
			containerWithSource as unknown as IContainer<TRequires2>
		);
	})() as unknown as Layer<
		TRequires1 | Exclude<TRequires2, TProvides1>,
		TProvides1 | TProvides2
	>;
}

/**
 * Internal function to create a merged layer from two layers.
 * This implements the `.and()` method logic.
 *
 * @internal
 */
function createMergedLayer<
	TRequires1 extends AnyTag,
	TProvides1 extends AnyTag,
	TRequires2 extends AnyTag,
	TProvides2 extends AnyTag,
>(
	layer1: Layer<TRequires1, TProvides1>,
	layer2: Layer<TRequires2, TProvides2>
): Layer<TRequires1 | TRequires2, TProvides1 | TProvides2> {
	return layer((container) => {
		const container1 = layer1.register(container);
		return layer2.register(
			// Type assertion needed due to contravariance - composition is safe
			container1 as unknown as IContainer<TRequires2>
		);
	})() as unknown as Layer<TRequires1 | TRequires2, TProvides1 | TProvides2>;
}

/**
 * Helper type that extracts the union of all requirements from an array of layers.
 * Used by Layer.merge() to compute the correct requirement type for the merged layer.
 *
 * @internal
 */
type UnionOfRequires<T extends readonly Layer<AnyTag, AnyTag>[]> = {
	[K in keyof T]: T[K] extends Layer<infer R, AnyTag> ? R : never;
}[number];

/**
 * Helper type that extracts the union of all provisions from an array of layers.
 * Used by Layer.merge() to compute the correct provision type for the merged layer.
 *
 * @internal
 */
type UnionOfProvides<T extends readonly Layer<AnyTag, AnyTag>[]> = {
	[K in keyof T]: T[K] extends Layer<AnyTag, infer P> ? P : never;
}[number];

/**
 * Utility object containing helper functions for working with layers.
 */
export const Layer = {
	/**
	 * Creates an empty layer that provides no dependencies and requires no dependencies.
	 * This is useful as a base layer or for testing.
	 *
	 * @returns An empty layer that can be used as a starting point for layer composition
	 *
	 * @example
	 * ```typescript
	 * import { Layer } from '@/di/layer.js';
	 *
	 * const baseLayer = Layer.empty();
	 * const appLayer = baseLayer
	 *   .and(configLayer())
	 *   .and(serviceLayer());
	 * ```
	 */
	empty(): Layer {
		return layer((container) => container)();
	},

	/**
	 * Merges multiple layers at once in a type-safe way.
	 * This is equivalent to chaining `.and()` calls but more convenient for multiple layers.
	 *
	 * All layers are merged in order, combining their requirements and provisions.
	 * The resulting layer requires the union of all input layer requirements and
	 * provides the union of all input layer provisions.
	 *
	 * @template T - The tuple type of layers to merge
	 * @param layers - At least 2 layers to merge together
	 * @returns A new layer that combines all input layers
	 *
	 * @example Basic usage
	 * ```typescript
	 * import { Layer } from '@/di/layer.js';
	 *
	 * const infraLayer = Layer.merge(
	 *   databaseLayer(),
	 *   cacheLayer(),
	 *   loggingLayer()
	 * );
	 * ```
	 *
	 * @example Equivalent to chaining .and()
	 * ```typescript
	 * // These are equivalent:
	 * const layer1 = Layer.merge(layerA(), layerB(), layerC());
	 * const layer2 = layerA().and(layerB()).and(layerC());
	 * ```
	 *
	 * @example Building infrastructure layers
	 * ```typescript
	 * const persistenceLayer = layer<never, typeof DatabaseService | typeof CacheService>(...);
	 * const messagingLayer = layer<never, typeof MessageQueue>(...);
	 * const observabilityLayer = layer<never, typeof Logger | typeof Metrics>(...);
	 *
	 * // Merge all infrastructure concerns into one layer
	 * const infraLayer = Layer.merge(
	 *   persistenceLayer(),
	 *   messagingLayer(),
	 *   observabilityLayer()
	 * );
	 *
	 * // Now infraLayer provides: DatabaseService | CacheService | MessageQueue | Logger | Metrics
	 * ```
	 */
	merge<
		T extends readonly [
			Layer<AnyTag, AnyTag>,
			Layer<AnyTag, AnyTag>,
			...Layer<AnyTag, AnyTag>[],
		],
	>(...layers: T): Layer<UnionOfRequires<T>, UnionOfProvides<T>> {
		return layers.reduce((acc, layer) => acc.and(layer)) as Layer<
			UnionOfRequires<T>,
			UnionOfProvides<T>
		>;
	},
};
