import { DependencyContainer } from './di/container.js';
import { AnyTag } from './di/tag.js';

export interface DependencyLayer<
	TIn extends AnyTag,
	TOut extends AnyTag,
	TContainer extends DependencyContainer<TIn> = DependencyContainer<TIn>,
> {
	register: (
		container: TContainer
	) => TContainer extends DependencyContainer<infer TContainerIn>
		? DependencyContainer<TContainerIn | TOut>
		: never;

	/**
	 * Feeds the output services of one layer into the input of another layer,
	 * resulting in a new layer with the inputs of the first layer, and the
	 * outputs of both layers.
	 */
	provide: <
		TOtherIn extends AnyTag,
		TOtherOut extends AnyTag,
		TOtherContainer extends
			DependencyContainer<TOtherIn> = DependencyContainer<TOtherIn>,
	>(
		other: DependencyLayer<TOtherIn, TOtherOut, TOtherContainer>
	) => DependencyLayer<
		TIn | Exclude<TOtherIn, TOut>,
		TOut | TOtherOut,
		DependencyContainer<TIn | Exclude<TOtherIn, TOut>>
	>;
}

export function layer<
	TIn extends AnyTag = never,
	TOut extends AnyTag = never,
	TContainer extends DependencyContainer<TIn> = DependencyContainer<TIn>,
>(
	register: (
		container: TContainer
	) => TContainer extends DependencyContainer<infer TInServices>
		? DependencyContainer<TInServices | TOut>
		: never
): DependencyLayer<TIn, TOut, TContainer> {
	const layer: DependencyLayer<TIn, TOut, TContainer> = {
		register,
		provide(other) {
			return provideLayer(layer, other);
		},
	};
	return layer;
}

function provideLayer<
	TIn1 extends AnyTag,
	TOut1 extends AnyTag,
	TContainer1 extends DependencyContainer<TIn1>,
	TIn2 extends AnyTag,
	TOut2 extends AnyTag,
	TContainer2 extends DependencyContainer<TIn2>,
>(
	layer1: DependencyLayer<TIn1, TOut1, TContainer1>,
	layer2: DependencyLayer<TIn2, TOut2, TContainer2>
): DependencyLayer<
	TIn1 | Exclude<TIn2, TOut1>,
	TOut1 | TOut2,
	DependencyContainer<TIn1 | Exclude<TIn2, TOut1>>
> {
	return layer((container) => {
		const container1 = layer1.register(
			container as TContainer1
		) as DependencyContainer<TIn1 | TIn2 | TOut1>;
		return layer2.register(
			container1 as TContainer2
		) as DependencyContainer<TIn1 | TIn2 | TOut1 | TOut2>;
	});
}
