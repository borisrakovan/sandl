import { LambdaRequest, Prettify, PromiseOrValue, State } from './types.js';

export type MiddlewareName = string;

export type MiddlewareOptions<TState extends State, TOpts> =
	| ((state: TState) => TOpts)
	| TOpts;

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

	abstract apply(
		request: LambdaRequest<TEvent, TStateIn>,
		next: NextFunction<TEvent, TStateOut, TResIn>
	): PromiseOrValue<TResOut>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMiddleware = Middleware<any, any, any, any, any, any>;

export type NameOf<T extends AnyMiddleware> =
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	T extends Middleware<infer TName, any, any, any, any, any> ? TName : never;

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
	applyFn: Middleware<
		TName,
		TEvent,
		TStateIn,
		TStateOut,
		TResIn,
		TResOut
	>['apply']
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

		apply(
			request: LambdaRequest<TEvent, TStateIn>,
			next: NextFunction<TEvent, TStateOut, TResIn>
		): PromiseOrValue<TResOut> {
			return applyFn(request, next);
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
	middlewares: AnyMiddleware[]
) {
	// Start with the handler as the innermost function
	let chain = handler;

	// Process middlewares in reverse order to build the chain from inside out
	for (const middleware of [...middlewares].reverse()) {
		const nextChain = chain;
		chain = (req: LambdaRequest<TEvent, State>) =>
			middleware.apply(req, nextChain);
	}

	return chain as (
		request: LambdaRequest<TEvent, Record<string, unknown>>
	) => Promise<TRes>;
}
