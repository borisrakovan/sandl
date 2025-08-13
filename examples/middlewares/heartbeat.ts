import { BaseError } from '@/errors.js';
import { Middleware, NextFunction } from '@/middleware.js';
import { LambdaRequest, State } from '@/types.js';
import { Logger } from 'examples/internal/logger.js';

export type OptionsFromState<TState extends State, TOpts> =
	| ((state: TState) => TOpts)
	| TOpts;

class HeartbeatMiddleware<
	TEvent,
	TState extends { logger: Logger },
	TRes,
> extends Middleware<'heartbeat', TEvent, TState, TState, TRes, TRes> {
	constructor(
		private readonly options: OptionsFromState<
			TState,
			{ heartbeatId: string; heartbeatUrl: string }
		>
	) {
		super('heartbeat');
	}

    async apply(
        request: LambdaRequest<TEvent, TState>,
        next: NextFunction<TEvent, TState, TRes>
    ): Promise<TRes> {
		const logger = request.state.logger;
		const resolvedOptions =
			typeof this.options === 'function' ? this.options(request.state) : this.options;

		await sendHeartbeat(
			() =>
				fetch(
					`${resolvedOptions.heartbeatUrl}/${resolvedOptions.heartbeatId}`,
					{ method: 'GET' }
				),
			logger
		);

		try {
			return await next(request);
		} catch (err) {
			await sendHeartbeat(
				() =>
					fetch(
						`${resolvedOptions.heartbeatUrl}/${resolvedOptions.heartbeatId}/fail`,
						{ method: 'POST' }
					),
				logger
			);
			throw err;
		}
	}
}

export const heartbeat = <TEvent, TState extends { logger: Logger }, TRes>(
	options: OptionsFromState<
		TState,
		{ heartbeatId: string; heartbeatUrl: string }
	>
): Middleware<'heartbeat', TEvent, TState, TState, TRes, TRes> =>
	new HeartbeatMiddleware<TEvent, TState, TRes>(options);

async function sendHeartbeat(send: () => Promise<unknown>, logger: Logger) {
	try {
		logger.debug('Sending heartbeat');
		await send();
	} catch (error) {
		// Log the error but fail gracefully
		logger.error(
			{
				error: BaseError.ensure(error).dump(),
			},
			'Failed to send heartbeat'
		);
	}
}
