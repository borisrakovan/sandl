import {
	AnyMiddleware,
	middleware,
	Middleware,
	MiddlewareName,
} from './middleware.js';
import { LambdaRequest, PromiseOrValue, State } from './types.js';

export type ResourceScope = 'runtime' | 'request';

export type ResourceSpec<T, TEvent, TState extends State> = {
	scope: ResourceScope;
	init: (request: LambdaRequest<TEvent, TState>) => PromiseOrValue<T>;
	cleanup?: (val: T) => PromiseOrValue<void>;
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

export type GetResourceSpec<T extends AnyMiddleware> =
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
	let cached: TVal | null = null;

	const registerCleanup = (val: TVal) => {
		if (!spec.cleanup) return;

		process.once('SIGTERM', () => {
			void (async () => {
				try {
					await spec.cleanup!(val);
				} finally {
					cached = null;
				}
			})();
		});
	};

	return middleware(name, async (req, next) => {
		// This is safe from concurrent access because only one invocation of lambda function is running at a time,
		// and the middleware is always called only once per lambda request.
		// Otherwise we would need to cache the promise instead of the value to prevent race conditions.
		if (cached === null) {
			cached = await spec.init(req);
			registerCleanup(cached);
		}

		return next({
			...req,
			state: { ...req.state, [name]: cached },
		});
	});
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
	return middleware(name, async (req, next) => {
		const resource = await spec.init(req);

		let result;
		try {
			result = await next({
				...req,
				state: { ...req.state, [name]: resource },
			});
		} finally {
			await spec.cleanup?.(resource);
		}

		return result;
	});
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
