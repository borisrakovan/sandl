import loggerImpl, { Logger } from 'examples/internal/logger.js';
import { resource, ResourceMiddleware, State } from 'lambdaverse';

export const logger = <
	TEvent,
	TState extends State,
	TRes,
>(): ResourceMiddleware<'logger', TEvent, TState, TRes, Logger> => {
	return resource('logger', {
		scope: 'runtime',
		init: () => loggerImpl,
	});
};
