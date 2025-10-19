import { IContainer } from './container.js';
import { AnyTag } from './tag.js';

export type ResolutionContext<TReg extends AnyTag> = Pick<
	IContainer<TReg>,
	'get'
>;

/**
 * The most generic layer type that works with variance - accepts any concrete layer.
 *
 * This type is carefully constructed to work with the Layer interface's variance annotations:
 * - `never` for TRequires (contravariant): Any layer requiring specific dependencies can be
 *   assigned to this since requiring something is more restrictive than requiring nothing
 * - `AnyTag` for TProvides (covariant): Any layer providing specific services can be assigned
 *   to this since the general AnyTag type can represent any specific tag type
 *
 * Used internally for functions like Layer.mergeAll() that need to accept arrays of layers
 * with different requirement/provision types while preserving type safety through variance.
 */
export type AnyLayer = Layer<never, AnyTag>;

/**
 * A dependency layer represents a reusable, composable unit of dependency registrations.
 * Layers allow you to organize your dependency injection setup into logical groups
 * that can be combined and reused across different contexts.
 *
 * ## Type Variance
 *
 * The Layer interface uses TypeScript's variance annotations to enable safe substitutability:
 *
 * ### TRequires (contravariant with `in`)
 * A layer requiring fewer dependencies can substitute one requiring more:
 * - `Layer<never, X>` can be used where `Layer<A | B, X>` is expected
 * - Intuition: A service that needs nothing is more flexible than one that needs specific deps
 *
 * ### TProvides (covariant with `out`)
 * A layer providing more services can substitute one providing fewer:
 * - `Layer<X, A | B>` can be used where `Layer<X, A>` is expected
 * - Intuition: A service that gives you extra things is compatible with expecting fewer things
 *
 * @template TRequires - The union of tags this layer requires to be satisfied by other layers
 * @template TProvides - The union of tags this layer provides/registers
 *
 * @example Basic layer usage
 * ```typescript
 * import { layer, Tag, container } from 'sandl';
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
 * const finalContainer = databaseLayer.register(c);
 *
 * const db = await finalContainer.get(DatabaseService);
 * ```
 *
 * @example Layer composition with variance
 * ```typescript
 * // Layer that requires DatabaseService and provides UserService
 * const userLayer = layer<typeof DatabaseService, typeof UserService>((container) =>
 *   container.register(UserService, async (ctx) =>
 *     new UserService(await ctx.get(DatabaseService))
 *   )
 * );
 *
 * // Compose layers: database layer provides what user layer needs
 * const appLayer = databaseLayer.to(userLayer);
 *
 * // Thanks to variance, Layer<never, typeof DatabaseService> automatically works
 * // where Layer<typeof DatabaseService, typeof UserService> requires DatabaseService
 * ```
 */
export interface Layer<
	// Contravariant: A layer requiring fewer dependencies can substitute one requiring more
	// Layer<never, X> can be used where Layer<A | B, X> is expected (less demanding is more compatible)
	in TRequires extends AnyTag = never,
	// Covariant: A layer providing more services can substitute one providing fewer
	// Layer<X, A | B> can be used where Layer<X, A> is expected (more generous is more compatible)
	out TProvides extends AnyTag = never,
> {
	/**
	 * Applies this layer's registrations to the given container.
	 *
	 * ## Generic Container Support
	 *
	 * The signature uses `TContainer extends AnyTag` to accept containers with any existing
	 * services while preserving type information. The container must provide at least this
	 * layer's requirements (`TRequires`) but can have additional services (`TContainer`).
	 *
	 * Result container has: `TRequires | TContainer | TProvides` - everything that was
	 * already there plus this layer's new provisions.
	 *
	 * @param container - The container to register dependencies into (must satisfy TRequires)
	 * @returns A new container with this layer's dependencies registered and all existing services preserved
	 *
	 * @example Basic usage
	 * ```typescript
	 * const c = container();
	 * const updatedContainer = myLayer.register(c);
	 * ```
	 *
	 * @example With existing services preserved
	 * ```typescript
	 * const baseContainer = container()
	 *   .register(ExistingService, () => new ExistingService());
	 *
	 * const enhanced = myLayer.register(baseContainer);
	 * // Enhanced container has both ExistingService and myLayer's provisions
	 * ```
	 */
	register: <TContainer extends AnyTag>(
		container: IContainer<TRequires | TContainer>
	) => IContainer<TRequires | TContainer | TProvides>;

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
	 * const infraLayer = configLayer.to(dbLayer);
	 * ```
	 *
	 * @example Multi-level composition
	 * ```typescript
	 * const appLayer = configLayer
	 *   .to(databaseLayer)
	 *   .to(serviceLayer)
	 *   .to(apiLayer);
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
	 * const infraLayer = persistenceLayer.and(loggingLayer);
	 * ```
	 *
	 * @example Building complex layer combinations
	 * ```typescript
	 * const appInfraLayer = persistenceLayer
	 *   .and(messagingLayer)
	 *   .and(observabilityLayer);
	 * ```
	 */
	and: <TOtherRequires extends AnyTag, TOtherProvides extends AnyTag>(
		other: Layer<TOtherRequires, TOtherProvides>
	) => Layer<TRequires | TOtherRequires, TProvides | TOtherProvides>;
}

/**
 * Creates a new dependency layer that encapsulates a set of dependency registrations.
 * Layers are the primary building blocks for organizing and composing dependency injection setups.
 *
 * @template TRequires - The union of dependency tags this layer requires from other layers or external setup
 * @template TProvides - The union of dependency tags this layer registers/provides
 *
 * @param register - Function that performs the dependency registrations. Receives a container.
 * @returns The layer instance.
 *
 * @example Simple layer
 * ```typescript
 * import { layer, Tag } from 'sandl';
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
 * const dbLayerInstance = databaseLayer;
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
 *       .register(DatabaseService, async (ctx) => new DatabaseService(await ctx.get(ConfigTag)))
 *       .register(CacheService, async (ctx) => new CacheService(await ctx.get(ConfigTag)))
 * );
 *
 * // Service layer (requires infrastructure)
 * const serviceLayer = layer<typeof DatabaseService | typeof CacheService, typeof UserService>(
 *   (container) =>
 *     container.register(UserService, async (ctx) =>
 *       new UserService(await ctx.get(DatabaseService), await ctx.get(CacheService))
 *     )
 * );
 *
 * // Compose the complete application
 * const appLayer = configLayer.to(infraLayer).to(serviceLayer);
 * ```
 */
export function layer<
	TRequires extends AnyTag = never,
	TProvides extends AnyTag = never,
>(
	register: <TContainer extends AnyTag>(
		container: IContainer<TRequires | TContainer>
	) => IContainer<TRequires | TContainer | TProvides>
): Layer<TRequires, TProvides> {
	const layerImpl: Layer<TRequires, TProvides> = {
		register: <TContainer extends AnyTag>(
			container: IContainer<TRequires | TContainer>
		) => register(container),
		to(target) {
			return createComposedLayer(layerImpl, target);
		},
		and(other) {
			return createMergedLayer(layerImpl, other);
		},
	};
	return layerImpl;
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
	return layer(
		<TContainer extends AnyTag>(
			container: IContainer<TRequires1 | TContainer>
		) => {
			const containerWithSource = source.register(
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
				container as any
			);
			const finalContainer = target.register(
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
				containerWithSource as any
			) as IContainer<TRequires1 | TContainer | TProvides1 | TProvides2>;
			return finalContainer;
		}
	);
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
	return layer(
		<TContainer extends AnyTag>(
			container: IContainer<TRequires1 | TRequires2 | TContainer>
		) => {
			const container1 = layer1.register(container);
			const container2 = layer2.register(container1);
			return container2;
		}
	);
}

/**
 * Helper type that extracts the union of all requirements from an array of layers.
 * Used by Layer.mergeAll() to compute the correct requirement type for the merged layer.
 *
 * Works with AnyLayer[] constraint which accepts any concrete layer through variance:
 * - Layer<never, X> → extracts `never` (no requirements)
 * - Layer<A | B, Y> → extracts `A | B` (specific requirements)
 *
 * @internal
 */
type UnionOfRequires<T extends readonly AnyLayer[]> = {
	[K in keyof T]: T[K] extends Layer<infer R, AnyTag> ? R : never;
}[number];

/**
 * Helper type that extracts the union of all provisions from an array of layers.
 * Used by Layer.mergeAll() to compute the correct provision type for the merged layer.
 *
 * Works with AnyLayer[] constraint which accepts any concrete layer through variance:
 * - Layer<X, never> → extracts `never` (no provisions)
 * - Layer<Y, A | B> → extracts `A | B` (specific provisions)
 *
 * @internal
 */
type UnionOfProvides<T extends readonly AnyLayer[]> = {
	[K in keyof T]: T[K] extends Layer<never, infer P> ? P : never;
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
	 * import { Layer } from 'sandl';
	 *
	 * const baseLayer = Layer.empty();
	 * const appLayer = baseLayer
	 *   .and(configLayer)
	 *   .and(serviceLayer);
	 * ```
	 */
	empty(): Layer {
		return layer(
			<TContainer extends AnyTag>(container: IContainer<TContainer>) =>
				container
		);
	},

	/**
	 * Merges multiple layers at once in a type-safe way.
	 * This is equivalent to chaining `.and()` calls but more convenient for multiple layers.
	 *
	 * ## Type Safety with Variance
	 *
	 * Uses the AnyLayer constraint (Layer<never, AnyTag>) which accepts any concrete layer
	 * through the Layer interface's variance annotations:
	 *
	 * - **Contravariant TRequires**: Layer<typeof ServiceA, X> can be passed because requiring
	 *   ServiceA is more restrictive than requiring `never` (nothing)
	 * - **Covariant TProvides**: Layer<Y, typeof ServiceB> can be passed because providing
	 *   ServiceB is compatible with the general `AnyTag` type
	 *
	 * The return type correctly extracts and unions the actual requirement/provision types
	 * from all input layers, preserving full type safety.
	 *
	 * All layers are merged in order, combining their requirements and provisions.
	 * The resulting layer requires the union of all input layer requirements and
	 * provides the union of all input layer provisions.
	 *
	 * @template T - The tuple type of layers to merge (constrained to AnyLayer for variance)
	 * @param layers - At least 2 layers to merge together
	 * @returns A new layer that combines all input layers with correct union types
	 *
	 * @example Basic usage with different layer types
	 * ```typescript
	 * import { Layer } from 'sandl';
	 *
	 * // These all have different types but work thanks to variance:
	 * const dbLayer = layer<never, typeof DatabaseService>(...);           // no requirements
	 * const userLayer = layer<typeof DatabaseService, typeof UserService>(...); // requires DB
	 * const configLayer = layer<never, typeof ConfigService>(...);        // no requirements
	 *
	 * const infraLayer = Layer.mergeAll(dbLayer, userLayer, configLayer);
	 * // Type: Layer<typeof DatabaseService, typeof DatabaseService | typeof UserService | typeof ConfigService>
	 * ```
	 *
	 * @example Equivalent to chaining .and()
	 * ```typescript
	 * // These are equivalent:
	 * const layer1 = Layer.mergeAll(layerA, layerB, layerC);
	 * const layer2 = layerA.and(layerB).and(layerC);
	 * ```
	 *
	 * @example Building infrastructure layers
	 * ```typescript
	 * const persistenceLayer = layer<never, typeof DatabaseService | typeof CacheService>(...);
	 * const messagingLayer = layer<never, typeof MessageQueue>(...);
	 * const observabilityLayer = layer<never, typeof Logger | typeof Metrics>(...);
	 *
	 * // Merge all infrastructure concerns into one layer
	 * const infraLayer = Layer.mergeAll(
	 *   persistenceLayer,
	 *   messagingLayer,
	 *   observabilityLayer
	 * );
	 *
	 * // Result type: Layer<never, DatabaseService | CacheService | MessageQueue | Logger | Metrics>
	 * ```
	 */
	mergeAll<T extends readonly [AnyLayer, AnyLayer, ...AnyLayer[]]>(
		...layers: T
	): Layer<UnionOfRequires<T>, UnionOfProvides<T>> {
		return layers.reduce((acc, layer) => acc.and(layer)) as Layer<
			UnionOfRequires<T>,
			UnionOfProvides<T>
		>;
	},

	/**
	 * Merges exactly two layers, combining their requirements and provisions.
	 * This is similar to the `.and()` method but available as a static function.
	 *
	 * @template TRequires1 - What the first layer requires
	 * @template TProvides1 - What the first layer provides
	 * @template TRequires2 - What the second layer requires
	 * @template TProvides2 - What the second layer provides
	 * @param layer1 - The first layer to merge
	 * @param layer2 - The second layer to merge
	 * @returns A new merged layer requiring both layers' requirements and providing both layers' provisions
	 *
	 * @example Merging two layers
	 * ```typescript
	 * import { Layer } from 'sandl';
	 *
	 * const dbLayer = layer<never, typeof DatabaseService>(...);
	 * const cacheLayer = layer<never, typeof CacheService>(...);
	 *
	 * const persistenceLayer = Layer.merge(dbLayer, cacheLayer);
	 * // Type: Layer<never, typeof DatabaseService | typeof CacheService>
	 * ```
	 */
	merge<
		TRequires1 extends AnyTag,
		TProvides1 extends AnyTag,
		TRequires2 extends AnyTag,
		TProvides2 extends AnyTag,
	>(
		layer1: Layer<TRequires1, TProvides1>,
		layer2: Layer<TRequires2, TProvides2>
	): Layer<TRequires1 | TRequires2, TProvides1 | TProvides2> {
		return layer1.and(layer2);
	},
};
