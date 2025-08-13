import {
	BasicDependencyContainer,
	DependencyContainer,
} from '@/di/container.js';
import { Layer } from '@/di/layer.js';
import { AnyTag } from '@/di/tag.js';
import { Middleware, NextFunction } from '@/middleware.js';
import { ResourceMiddleware } from '@/resource.js';
import { LambdaRequest, PromiseOrValue, State } from '@/types.js';

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
	constructor(private readonly layer: Layer<never, TReg>) {
		super('container');
	}

	execute(
		request: LambdaRequest<TEvent, TState>,
		next: NextFunction<
			TEvent,
			TState & { container: DependencyContainer<TReg> },
			TRes
		>
	): PromiseOrValue<TRes> {
		const container = this.layer.register(
			new BasicDependencyContainer<TReg>()
		);
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
	layer: Layer<never, TReg>
): ResourceMiddleware<
	'container',
	TEvent,
	TState,
	TRes,
	DependencyContainer<TReg>
> => new DependencyContainerMiddleware<TEvent, TRes, TState, TReg>(layer);
