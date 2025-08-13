import {
	AnyMiddleware,
	Middleware,
	MiddlewareName,
	NextFunction,
} from './middleware.js';
import { LambdaRequest, PromiseOrValue, State } from './types.js';

export type ResourceScope = 'runtime' | 'request';

export type ResourceSpec<T, TEvent, TState extends State> = {
	scope: ResourceScope;
	init: (request: LambdaRequest<TEvent, TState>) => PromiseOrValue<T>;
	// TODO: document that cleanup gets a request with certain expected state
	// but it might have happened that some of the middlewares applied later in
	// the chain have changed the state. Modifying the existing state passed by
	// some other middleware is therefore discouraged because it might lead to
	// unexpected behavior and runtime errors.
	cleanup?: (
		val: T,
		request: LambdaRequest<TEvent, TState>
	) => PromiseOrValue<void>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyResourceSpec = ResourceSpec<any, any, any>;

export type ResourceMiddleware<
	TName extends MiddlewareName,
	TEvent,
	TState extends State,
	TRes,
	TVal,
> = Middleware<TName, TEvent, TState, TState & Record<TName, TVal>, TRes, TRes>;

export type ResourceSpecOf<T extends AnyMiddleware> =
	T extends Middleware<
		infer TName,
		infer TEvent,
		infer TState,
		infer TStateOut,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		any,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		any
	>
		? ResourceSpec<TStateOut[TName], TEvent, TState>
		: never;

// Base abstract resource using template method pattern
export abstract class AbstractResource<
	TName extends MiddlewareName,
	TEvent,
	TState extends State,
	TRes,
	TVal,
> extends Middleware<
	TName,
	TEvent,
	TState,
	TState & Record<TName, TVal>,
	TRes,
	TRes
> {
	protected abstract init(
		req: LambdaRequest<TEvent, TState>
	): PromiseOrValue<TVal>;

	// Optional cleanup; default no-op
	protected cleanup?(
		val: TVal,
		req: LambdaRequest<TEvent, TState>
	): PromiseOrValue<void>;
}

export abstract class RuntimeResource<
	TName extends MiddlewareName,
	TEvent,
	TState extends State,
	TRes,
	TVal,
> extends AbstractResource<TName, TEvent, TState, TRes, TVal> {
	private cached: TVal | null = null;

	protected registerCleanup(val: TVal, req: LambdaRequest<TEvent, TState>) {
		if (!this.cleanup) return;
		process.once('SIGTERM', () => {
			void (async () => {
				try {
					await this.cleanup!(val, req);
				} finally {
					this.cached = null;
				}
			})();
		});
	}

	async apply(
		req: LambdaRequest<TEvent, TState>,
		next: NextFunction<TEvent, TState & Record<TName, TVal>, TRes>
	): Promise<TRes> {
		if (this.cached === null) {
			this.cached = await this.init(req);
			this.registerCleanup(this.cached, req);
		}

		return next({
			...req,
			state: { ...req.state, [this.name]: this.cached },
		});
	}
}

export abstract class RequestResource<
	TName extends MiddlewareName,
	TEvent,
	TState extends State,
	TRes,
	TVal,
> extends AbstractResource<TName, TEvent, TState, TRes, TVal> {
	async apply(
		req: LambdaRequest<TEvent, TState>,
		next: NextFunction<TEvent, TState & Record<TName, TVal>, TRes>
	): Promise<TRes> {
		const resource = await this.init(req);
		try {
			return await next({
				...req,
				state: { ...req.state, [this.name]: resource },
			});
		} finally {
			await this.cleanup?.(resource, req);
		}
	}
}

function runtimeResource<
	TEvent,
	TRes,
	TState extends State = State,
	TVal = unknown,
	TName extends string = string,
>(
	name: TName,
	spec: ResourceSpec<TVal, TEvent, TState>
): ResourceMiddleware<TName, TEvent, TState, TRes, TVal> {
	class RuntimeResourceFromSpec extends RuntimeResource<
		TName,
		TEvent,
		TState,
		TRes,
		TVal
	> {
		constructor() {
			super(name);
		}

		protected init(req: LambdaRequest<TEvent, TState>) {
			return spec.init(req);
		}

		protected override cleanup(
			val: TVal,
			req: LambdaRequest<TEvent, TState>
		) {
			return spec.cleanup?.(val, req);
		}
	}

	return new RuntimeResourceFromSpec();
}

function requestResource<
	TEvent,
	TRes,
	TState extends State = State,
	TVal = unknown,
	TName extends string = string,
>(
	name: TName,
	spec: ResourceSpec<TVal, TEvent, TState>
): ResourceMiddleware<TName, TEvent, TState, TRes, TVal> {
	class RequestResourceFromSpec extends RequestResource<
		TName,
		TEvent,
		TState,
		TRes,
		TVal
	> {
		constructor() {
			super(name);
		}

		protected init(req: LambdaRequest<TEvent, TState>) {
			return spec.init(req);
		}

		protected override cleanup(
			val: TVal,
			req: LambdaRequest<TEvent, TState>
		) {
			return spec.cleanup?.(val, req);
		}
	}

	return new RequestResourceFromSpec();
}

export function resource<
	TName extends string,
	TVal,
	TEvent,
	TState extends State,
	TRes,
>(
	name: TName,
	spec: ResourceSpec<TVal, TEvent, TState>
): ResourceMiddleware<TName, TEvent, TState, TRes, TVal> {
	return spec.scope === 'runtime'
		? runtimeResource(name, spec)
		: requestResource(name, spec);
}
