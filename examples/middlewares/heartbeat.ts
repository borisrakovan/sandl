import { BaseError } from '@/errors.js';
import { Middleware, NextFunction } from '@/middleware.js';
import { LambdaRequest } from '@/types.js';
import { Logger } from 'examples/internal/logger.js';

class HeartbeatMiddleware<
	TEvent,
	TState extends { logger: Logger },
	TRes,
> extends Middleware<'heartbeat', TEvent, TState, TState, TRes, TRes> {
	constructor(
		private readonly options: { heartbeatId: string; heartbeatUrl: string }
	) {
		super('heartbeat');
	}

	async execute(
		request: LambdaRequest<TEvent, TState>,
		next: NextFunction<TEvent, TState, TRes>
	): Promise<TRes> {
		const logger = request.state.logger;

		await this.sendHeartbeat(
			() =>
				fetch(
					`${this.options.heartbeatUrl}/${this.options.heartbeatId}`,
					{ method: 'GET' }
				),
			logger
		);

		try {
			return await next(request);
		} catch (err) {
			await this.sendHeartbeat(
				() =>
					fetch(
						`${this.options.heartbeatUrl}/${this.options.heartbeatId}/fail`,
						{ method: 'POST' }
					),
				logger
			);
			throw err;
		}
	}

	private async sendHeartbeat(send: () => Promise<unknown>, logger: Logger) {
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
}

export const heartbeat = <
	TEvent,
	TState extends { logger: Logger },
	TRes,
>(options: {
	heartbeatId: string;
	heartbeatUrl: string;
}): Middleware<'heartbeat', TEvent, TState, TState, TRes, TRes> =>
	new HeartbeatMiddleware<TEvent, TState, TRes>(options);
