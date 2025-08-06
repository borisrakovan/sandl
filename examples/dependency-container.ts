import { DependencyContainer } from '@/container.js';
import { DependencyLayer } from '@/layer.js';
import { resource, ResourceMiddleware } from '@/resource.js';
import { State } from '@/types.js';

type EnvFromState<TState> = TState extends { env: infer TEnv } ? TEnv : unknown;
type SecretsFromState<TState> = TState extends { secrets: infer TSecrets }
	? TSecrets
	: unknown;

export const dependencyContainer = <
	TEvent,
	TRes,
	TState extends State,
	TServices,
>(
	layerFactory: (
		env: EnvFromState<TState>,
		secrets: SecretsFromState<TState>
	) => DependencyLayer<never, TServices>
): ResourceMiddleware<
	'container',
	TEvent,
	TState,
	TRes,
	DependencyContainer<TServices>
> => {
	return resource('container', {
		scope: 'request',
		init: (request) => {
			const layer = layerFactory(
				request.state.env as EnvFromState<TState>,
				request.state.secrets as SecretsFromState<TState>
			);
			return layer.register(new DependencyContainer());
		},
		cleanup: (container) => container.destroy(),
	});
};
