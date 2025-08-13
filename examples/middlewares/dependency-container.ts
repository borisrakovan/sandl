import { DependencyContainer } from '@/di/container.js';
import { AnyTag } from '@/di/tag.js';
import { Layer } from '@/di/layer.js';
import { ResourceMiddleware } from '@/resource.js';
import { LambdaRequest, PromiseOrValue, State } from '@/types.js';
import { Middleware } from '@/middleware.js';

type EnvFromState<TState> = TState extends { env: infer TEnv } ? TEnv : unknown;
type SecretsFromState<TState> = TState extends { secrets: infer TSecrets }
	? TSecrets
	: unknown;

class DependencyContainerMiddleware<
	TEvent,
	TRes,
	TState extends State,
	TReg extends AnyTag,
> extends Middleware<
	'container',
	TEvent,
	TState,
	TState & { container: DependencyContainer<TReg> },
	TRes,
	TRes
> {
	constructor(
		private readonly layerFactory: (
			env: EnvFromState<TState>,
			secrets: SecretsFromState<TState>
		) => Layer<never, TReg>
	) {
		super('container');
	}

	apply(
		request: LambdaRequest<TEvent, TState>,
		next: (
			request: LambdaRequest<TEvent, TState & { container: DependencyContainer<TReg> }>
		) => PromiseOrValue<TRes>
	): PromiseOrValue<TRes> {
		const layer = this.layerFactory(
			request.state.env as EnvFromState<TState>,
			request.state.secrets as SecretsFromState<TState>
		);
		const container = layer.register(new DependencyContainer<TReg>());
		try {
			return next({ ...request, state: { ...request.state, container } });
		} finally {
			void container.destroy();
		}
	}
}

export const dependencyContainer = <
	TEvent,
	TRes,
	TState extends State,
	TReg extends AnyTag,
>(
	layerFactory: (
		env: EnvFromState<TState>,
		secrets: SecretsFromState<TState>
	) => Layer<never, TReg>
): ResourceMiddleware<
	'container',
	TEvent,
	TState,
	TRes,
	DependencyContainer<TReg>
> => new DependencyContainerMiddleware<TEvent, TRes, TState, TReg>(layerFactory);
