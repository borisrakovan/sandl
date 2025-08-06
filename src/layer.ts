import { DependencyContainer } from './container.js';

export interface DependencyLayer<
	TIn,
	TOut,
	TContainer extends DependencyContainer<TIn> = DependencyContainer<TIn>,
> {
	register: (
		container: TContainer
	) => TContainer extends DependencyContainer<infer TIn>
		? DependencyContainer<TIn | TOut>
		: never;

	/**
	 * Feeds the output services of one layer into the input of another layer,
	 * resulting in a new layer with the inputs of the first layer, and the
	 * outputs of both layers.
	 */
	provide: <
		TOtherIn,
		TOtherOut,
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

/**
 * Create a layer from a register function
 */
export function layer<
	TIn,
	TOut,
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
	TIn1,
	TOut1,
	TContainer1 extends DependencyContainer<TIn1>,
	TIn2,
	TOut2,
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
