import { AnyMiddleware } from './middleware.js';
import { LambdaTestBuilder } from './test-builder.js';
import { AwsContext, State } from './types.js';

export interface LambdaHandler<
	TEvent,
	TRes,
	TState extends State,
	TMiddlewares extends AnyMiddleware,
> {
	(event: TEvent, context: AwsContext): Promise<TRes>;
	test: () => LambdaTestBuilder<TEvent, TRes, TState, TMiddlewares>;
}
