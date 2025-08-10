import { BaseError } from '@/errors.js';
import { middleware, Middleware } from '@/middleware.js';
import { State } from '@/types.js';
import { getKey } from '@/utils/object.js';
import { ApiError } from '../internal/errors.js';
import log from '../internal/logger.js';

// Flag to track cold start invocations
let coldStartRequest = true;

export const requestLogger = <TEvent, TState extends State, TRes>(): Middleware<
	'logger',
	TEvent,
	TState,
	TState,
	TRes,
	TRes
> => {
	return middleware('logger', async (request, next) => {
		// Log the start of processing
		log.info(
			{
				coldStart: coldStartRequest,
			},
			'Starting lambda execution'
		);
		coldStartRequest = false;
		const startTime = Date.now();

		let response;
		try {
			response = await next(request);
		} catch (err) {
			const duration = Date.now() - startTime;
			const statusCode = getKey(response, 'statusCode');

			let logFn = log.error.bind(log);

			// Log warnings for client errors
			if (err instanceof ApiError && err.statusCode < 500) {
				logFn = log.warn.bind(log);
			}

			logFn(
				{
					duration,
					error: BaseError.ensure(err).dump(),
					statusCode,
				},
				`Lambda execution failed in ${duration / 1000}s`
			);
			throw err;
		}

		const duration = Date.now() - startTime;
		const statusCode = getKey(response, 'statusCode');
		log.info(
			{ duration, statusCode },
			`Lambda execution completed in ${duration / 1000}s`
		);

		return response;
	});
};
