import { BaseError } from '@/errors.js';
import { Middleware, NextFunction } from '@/middleware.js';
import { LambdaRequest } from '@/types.js';
import { getKey } from '@/utils/object.js';
import { Logger } from 'examples/internal/logger.js';
import { ApiError } from '../internal/errors.js';

// Flag to track cold start invocations
let coldStartInvocation = true;

class RequestLogger<
	TEvent,
	TState extends { logger: Logger },
	TRes,
> extends Middleware<'requestLogger', TEvent, TState, TState, TRes, TRes> {
	constructor() {
		super('requestLogger');
	}

    async apply(
        request: LambdaRequest<TEvent, TState>,
        next: NextFunction<TEvent, TState, TRes>
    ): Promise<TRes> {
		const logger = request.state.logger;
		logger.info(
			{ coldStart: coldStartInvocation },
			'Starting lambda execution'
		);
		coldStartInvocation = false;
		const startTime = Date.now();

		let response: TRes | undefined;
		try {
			response = await next(request);
		} catch (err) {
			const duration = Date.now() - startTime;
			const statusCode = getKey(response, 'statusCode');

			let logFn = logger.error.bind(logger);
			if (err instanceof ApiError && err.statusCode < 500) {
				// Log client errors as warnings
				logFn = logger.warn.bind(logger);
			}

			logFn(
				{ duration, error: BaseError.ensure(err).dump(), statusCode },
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
	}
}

export const requestLogger = <
	TEvent,
	TState extends { logger: Logger },
	TRes,
>(): Middleware<'requestLogger', TEvent, TState, TState, TRes, TRes> =>
	new RequestLogger<TEvent, TState, TRes>();
