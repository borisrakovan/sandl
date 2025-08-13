import {
	AnyMiddleware,
	createHandlerMiddlewareChain,
	NameOf,
} from './middleware.js';
import { resource, ResourceSpecOf } from './resource.js';
import { AwsContext, LambdaRequest, State } from './types.js';

export class LambdaTestBuilder<
	TEvent,
	TRes,
	TState extends State,
	TMiddlewares extends AnyMiddleware = never,
> {
	private readonly originalMiddlewares: (
		| AnyMiddleware
		| ((state: State) => AnyMiddleware)
	)[] = [];
	private readonly middlewareOverrides = new Map<
		NameOf<TMiddlewares>,
		AnyMiddleware
	>();

	constructor(
		middlewares: (AnyMiddleware | ((state: State) => AnyMiddleware))[],
		private readonly handler: (
			request: LambdaRequest<TEvent, TState>
		) => unknown
	) {
		this.originalMiddlewares = middlewares;
	}

	skipMiddleware(name: NameOf<TMiddlewares>): this {
		this.middlewareOverrides.set(name, {
			name,
			// No-op middleware
			execute: (request, next) => next(request) as unknown,
		});
		return this;
	}

	withMiddleware<TName extends NameOf<TMiddlewares>>(
		name: TName,
		// Extract the middleware with the given name from the union type
		overrideFn: Extract<TMiddlewares, { name: TName }>['execute']
	): this {
		this.middlewareOverrides.set(name, {
			name,
			execute: overrideFn,
		});
		return this;
	}

	withResource<TName extends NameOf<TMiddlewares>>(
		name: TName,
		spec: ResourceSpecOf<Extract<TMiddlewares, { name: TName }>>
	): this {
		this.middlewareOverrides.set(name, resource(name, spec));
		return this;
	}

	execute(event: TEvent, context: AwsContext): Promise<TRes> {
		// Final exported lambda handler
		const testHandler = async (
			event: TEvent,
			context: AwsContext
		): Promise<TRes> => {
			// Create the handler chain
			const chain = createHandlerMiddlewareChain<TEvent, TRes, TState>(
				this.handler,
				this.originalMiddlewares,
				this.middlewareOverrides
			);
			// Execute the entire chain on the initial request
			return chain({
				event,
				context,
				state: {},
			});
		};

		return testHandler(event, context);
	}
}
