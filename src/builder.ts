import { LambdaHandler } from './handler.js';
import {
	AnyMiddleware,
	createHandlerMiddlewareChain,
	Middleware,
	MiddlewareName,
} from './middleware.js';
import { LambdaTestBuilder } from './test-builder.js';
import {
	AwsContext,
	LambdaRequest,
	Prettify,
	PromiseOrValue,
	State,
} from './types.js';

export class LambdaBuilder<
	TEvent,
	TRes,
	CurState extends State = State,
	CurRes = TRes,
	CurMiddlewares extends AnyMiddleware = never,
> {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private middlewares: (AnyMiddleware | ((state: any) => AnyMiddleware))[] =
		[];

	constructor() {
		this.middlewares = [];
	}

	use<
		NewRes,
		NewName extends MiddlewareName,
		NewState extends State = CurState,
	>(
		middleware: Middleware<
			NewName,
			TEvent,
			CurState,
			NewState,
			NewRes,
			CurRes
		>
	): LambdaBuilder<
		TEvent,
		TRes,
		NewState,
		NewRes,
		CurMiddlewares | typeof middleware
	> {
		this.middlewares.push(middleware);
		return this as unknown as LambdaBuilder<
			TEvent,
			TRes,
			NewState,
			NewRes,
			CurMiddlewares | typeof middleware
		>;
	}

	useFactory<
		NewRes,
		NewName extends MiddlewareName,
		NewState extends State = CurState,
	>(
		// name: NewName,
		factory: (
			state: CurState
		) => Middleware<NewName, TEvent, CurState, NewState, NewRes, CurRes>
	): LambdaBuilder<
		TEvent,
		TRes,
		NewState,
		NewRes,
		| CurMiddlewares
		| Middleware<NewName, TEvent, CurState, NewState, NewRes, CurRes>
	> {
		// const mw = createMiddleware<
		// 	NewName,
		// 	TEvent,
		// 	CurState,
		// 	NewState,
		// 	NewRes,
		// 	CurRes
		// >(name, (req, next) => {
		// 	const mw = factory(req.state as CurState);
		// 	return mw.execute(req, next);
		// });
		this.middlewares.push(factory);
		return this as unknown as LambdaBuilder<
			TEvent,
			TRes,
			NewState,
			NewRes,
			CurMiddlewares | ReturnType<typeof factory>
		>;
	}

	handle(
		handler: (
			request: LambdaRequest<TEvent, Prettify<CurState>>
		) => PromiseOrValue<CurRes>
	): LambdaHandler<TEvent, TRes, CurState, CurMiddlewares> {
		// Final exported lambda handler
		const lambdaHandler = async (
			event: TEvent,
			context: AwsContext
		): Promise<TRes> => {
			const chain = createHandlerMiddlewareChain<TEvent, TRes, CurState>(
				handler,
				this.middlewares
			);
			// Execute the entire chain with an initial empty state
			return chain({
				event,
				context,
				state: {},
			});
		};

		return Object.assign(lambdaHandler, {
			test: () =>
				new LambdaTestBuilder<TEvent, TRes, CurState, CurMiddlewares>(
					this.middlewares,
					handler
				),
		});
	}
}

export function lambda<TEvent, TRes>() {
	return new LambdaBuilder<TEvent, TRes>();
}
