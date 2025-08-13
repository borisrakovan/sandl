import { resource, ResourceMiddleware } from '@/resource.js';
import { State } from '@/types.js';
import loggerImpl, { Logger } from 'examples/internal/logger.js';

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
