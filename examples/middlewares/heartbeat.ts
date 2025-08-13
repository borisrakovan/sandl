import { BaseError } from '@/errors.js';
import { middleware, Middleware } from '@/middleware.js';
import { State } from '@/types.js';
import { Logger } from 'examples/internal/logger.js';

export type OptionsFromState<TState extends State, TOpts> =
	| ((state: TState) => TOpts)
	| TOpts;

export const heartbeat = <TEvent, TState extends { logger: Logger }, TRes>(
	options: OptionsFromState<
		TState,
		{ heartbeatId: string; heartbeatUrl: string }
	>
): Middleware<'heartbeat', TEvent, TState, TState, TRes, TRes> =>
	middleware('heartbeat', async (request, next) => {
		const logger = request.state.logger;

		const resolvedOptions =
			typeof options === 'function' ? options(request.state) : options;

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
			// Re-throw the error to trigger the error handler
			throw err;
		}
	});

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
