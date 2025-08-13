import { LambdaRequest, Prettify, PromiseOrValue, State } from './types.js';

export type MiddlewareName = string;

export type NextFunction<TEvent, TStateOut extends State, TResIn> = (
	request: LambdaRequest<TEvent, TStateOut>
) => PromiseOrValue<TResIn>;

export abstract class Middleware<
	TName extends MiddlewareName,
	TEvent,
	TStateIn extends State,
	TStateOut extends State,
	TResIn,
	TResOut,
> {
	readonly name: TName;

	constructor(name: TName) {
		this.name = name;
	}

	abstract execute(
		request: LambdaRequest<TEvent, TStateIn>,
		next: NextFunction<TEvent, TStateOut, TResIn>
	): PromiseOrValue<TResOut>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMiddleware = Middleware<MiddlewareName, any, any, any, any, any>;

export type NameOf<T extends AnyMiddleware> =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	T extends Middleware<infer TName, any, any, any, any, any> ? TName : never;

// (helper types for builder live in builder.ts)

// Functional factory kept for convenience
export function middleware<
	TName extends MiddlewareName,
	TEvent,
	TStateIn extends State,
	TStateOut extends State,
	TResIn,
	TResOut,
>(
	name: TName,
	executeFn: Middleware<
		TName,
		TEvent,
		TStateIn,
		TStateOut,
		TResIn,
		TResOut
	>['execute']
): Middleware<TName, TEvent, TStateIn, TStateOut, TResIn, TResOut> {
	class InlineMiddleware extends Middleware<
		TName,
		TEvent,
		TStateIn,
		TStateOut,
		TResIn,
		TResOut
	> {
		constructor() {
			super(name);
		}

		execute(
			request: LambdaRequest<TEvent, TStateIn>,
			next: NextFunction<TEvent, TStateOut, TResIn>
		): PromiseOrValue<TResOut> {
			return executeFn(request, next);
		}
	}

	return new InlineMiddleware();
}

export function createHandlerMiddlewareChain<
	TEvent,
	TRes,
	TState extends State,
>(
	handler: (request: LambdaRequest<TEvent, Prettify<TState>>) => unknown,
	middlewares: (AnyMiddleware | ((state: State) => AnyMiddleware))[],
	overrides?: Map<NameOf<AnyMiddleware>, AnyMiddleware>
) {
	// Start with the handler as the innermost function
	let chain = handler;

	// Process middlewares in reverse order to build the chain from inside out
	for (const middleware of [...middlewares].reverse()) {
		const nextChain = chain;
		chain = (req: LambdaRequest<TEvent, State>) => {
			let mw =
				typeof middleware === 'function'
					? middleware(req.state)
					: middleware;

			if (overrides?.has(mw.name) ?? false) {
				mw = overrides!.get(mw.name)!;
			}

			return mw.execute(req, nextChain);
		};
	}

	return chain as (
		request: LambdaRequest<TEvent, Record<string, unknown>>
	) => Promise<TRes>;
}
