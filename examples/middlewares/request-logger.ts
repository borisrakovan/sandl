import { BaseError } from '@/errors.js';
import { middleware, Middleware } from '@/middleware.js';
import { getKey } from '@/utils/object.js';
import { Logger } from 'examples/internal/logger.js';
import { ApiError } from '../internal/errors.js';

// Flag to track cold start invocations
let coldStartInvocation = true;

export const requestLogger = <
	TEvent,
	TState extends { logger: Logger },
	TRes,
>(): Middleware<'requestLogger', TEvent, TState, TState, TRes, TRes> => {
	return middleware('requestLogger', async (request, next) => {
		const logger = request.state.logger;
		// Log the start of processing
		logger.info(
			{
				coldStart: coldStartInvocation,
			},
			'Starting lambda execution'
		);
		coldStartInvocation = false;
		const startTime = Date.now();

		let response;
		try {
			response = await next(request);
		} catch (err) {
			const duration = Date.now() - startTime;
			const statusCode = getKey(response, 'statusCode');

			let logFn = logger.error.bind(logger);

			// Log warnings for client errors
			if (err instanceof ApiError && err.statusCode < 500) {
				logFn = logger.warn.bind(logger);
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
		logger.info(
			{ duration, statusCode },
			`Lambda execution completed in ${duration / 1000}s`
		);

		return response;
	});
};
