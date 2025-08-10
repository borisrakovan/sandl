import { DependencyContainer } from './di/container.js';
import { AnyTag } from './di/tag.js';

export interface DependencyLayer<
	TRequires extends AnyTag = never,
	TProvides extends AnyTag = never,
> {
	register: (
		container: DependencyContainer<TRequires>
	) => DependencyContainer<TRequires | TProvides>;

	/**
	 * Provides services to another layer. The target layer's requirements
	 * will be satisfied by this layer's provisions plus any remaining requirements.
	 */
	to: <TTargetRequires extends AnyTag, TTargetProvides extends AnyTag>(
		target: DependencyLayer<TTargetRequires, TTargetProvides>
	) => DependencyLayer<
		TRequires | Exclude<TTargetRequires, TProvides>,
		TProvides | TTargetProvides
	>;

	/**
	 * Merges this layer with another layer, combining their requirements and provisions.
	 */
	and: <TOtherRequires extends AnyTag, TOtherProvides extends AnyTag>(
		other: DependencyLayer<TOtherRequires, TOtherProvides>
	) => DependencyLayer<
		TRequires | TOtherRequires,
		TProvides | TOtherProvides
	>;
}

export function layer<
	TRequires extends AnyTag = never,
	TProvides extends AnyTag = never,
>(
	register: (
		container: DependencyContainer<TRequires>
	) => DependencyContainer<TRequires | TProvides>
): DependencyLayer<TRequires, TProvides> {
	const layerImpl: DependencyLayer<TRequires, TProvides> = {
		register,
		to(target) {
			return createComposedLayer(layerImpl, target);
		},
		and(other) {
			return createMergedLayer(layerImpl, other);
		},
	};
	return layerImpl;
}

function createComposedLayer<
	TRequires1 extends AnyTag,
	TProvides1 extends AnyTag,
	TRequires2 extends AnyTag,
	TProvides2 extends AnyTag,
>(
	source: DependencyLayer<TRequires1, TProvides1>,
	target: DependencyLayer<TRequires2, TProvides2>
): DependencyLayer<
	TRequires1 | Exclude<TRequires2, TProvides1>,
	TProvides1 | TProvides2
> {
	return layer((container) => {
		const containerWithSource = source.register(container);
		return target.register(
			containerWithSource as DependencyContainer<TRequires2>
		);
	}) as DependencyLayer<
		TRequires1 | Exclude<TRequires2, TProvides1>,
		TProvides1 | TProvides2
	>;
}

function createMergedLayer<
	TRequires1 extends AnyTag,
	TProvides1 extends AnyTag,
	TRequires2 extends AnyTag,
	TProvides2 extends AnyTag,
>(
	layer1: DependencyLayer<TRequires1, TProvides1>,
	layer2: DependencyLayer<TRequires2, TProvides2>
): DependencyLayer<TRequires1 | TRequires2, TProvides1 | TProvides2> {
	return layer((container) => {
		const container1 = layer1.register(container);
		return layer2.register(container1 as DependencyContainer<TRequires2>);
	}) as DependencyLayer<TRequires1 | TRequires2, TProvides1 | TProvides2>;
}

// Helper types for mergeAll
type UnionOfRequires<T extends readonly DependencyLayer<AnyTag, AnyTag>[]> = {
	[K in keyof T]: T[K] extends DependencyLayer<infer R, AnyTag> ? R : never;
}[number];

type UnionOfProvides<T extends readonly DependencyLayer<AnyTag, AnyTag>[]> = {
	[K in keyof T]: T[K] extends DependencyLayer<AnyTag, infer P> ? P : never;
}[number];

export const Layer = {
	empty(): DependencyLayer {
		return layer((container) => container);
	},

	// merge<
	// 	TRequires1 extends AnyTag,
	// 	TProvides1 extends AnyTag,
	// 	TRequires2 extends AnyTag,
	// 	TProvides2 extends AnyTag,
	// >(
	// 	layer1: DependencyLayer<TRequires1, TProvides1>,
	// 	layer2: DependencyLayer<TRequires2, TProvides2>
	// ): DependencyLayer<TRequires1 | TRequires2, TProvides1 | TProvides2> {
	// 	return createMergedLayer(layer1, layer2);
	// },

	/**
	 * Merge multiple layers at once in a type-safe way
	 */
	merge<
		T extends readonly [
			DependencyLayer<AnyTag, AnyTag>,
			DependencyLayer<AnyTag, AnyTag>,
			...DependencyLayer<AnyTag, AnyTag>[],
		],
	>(...layers: T): DependencyLayer<UnionOfRequires<T>, UnionOfProvides<T>> {
		return layers.reduce((acc, layer) => acc.and(layer)) as DependencyLayer<
			UnionOfRequires<T>,
			UnionOfProvides<T>
		>;
	},
};
