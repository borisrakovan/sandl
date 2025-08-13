import { DependencyContainer } from '@/di/container.js';
import { Middleware, NextFunction } from '@/middleware.js';
import { ResourceMiddleware } from '@/resource.js';
import { State } from '@/types.js';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { AuthService } from 'examples/internal/auth.service.js';
import { UnauthorizedError } from '../internal/errors.js';

export interface AuthContext {
	user: { id: string; name: string };
}

export const API_KEY_HEADER = 'X-Api-Key';

class ApiKeyAuth<
	TEvent extends APIGatewayProxyEventV2,
	TState extends State,
	TRes,
> extends Middleware<
	'auth',
	TEvent,
	TState,
	TState & { auth: AuthContext },
	TRes,
	TRes
> {
	constructor(
		private readonly options: {
			container: DependencyContainer<typeof AuthService>;
		}
	) {
		super('auth');
	}

	async execute(
		request: { event: TEvent; context: Context; state: TState },
		next: NextFunction<TEvent, TState & { auth: AuthContext }, TRes>
	): Promise<TRes> {
		const { event } = request;
		const authService = await this.options.container.get(AuthService);

		const apiKey = Object.entries(event.headers).find(
			([key]) => key.toLowerCase() === API_KEY_HEADER.toLowerCase()
		)?.[1];

		if (typeof apiKey !== 'string' || apiKey.length === 0) {
			throw new UnauthorizedError('API key is required');
		}

		let user;
		try {
			user = await authService.verifyApiKey(apiKey);
		} catch (err) {
			throw new UnauthorizedError('Invalid API key', { cause: err });
		}

		return next({
			...request,
			state: {
				...request.state,
				auth: { user: { id: user.id, name: user.name } },
			},
		});
	}
}

export const apiKeyAuth = <
	TEvent extends APIGatewayProxyEventV2,
	TState extends State,
	TRes,
>(options: {
	container: DependencyContainer<typeof AuthService>;
}): ResourceMiddleware<'auth', TEvent, TState, TRes, AuthContext> =>
	new ApiKeyAuth<TEvent, TState, TRes>(options);
