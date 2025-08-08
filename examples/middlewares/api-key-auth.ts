import { DependencyContainer } from '@/di/container.js';
import { resource, ResourceMiddleware } from '@/resource.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { AuthService } from 'examples/internal/auth.service.js';
import { UnauthorizedError } from '../internal/errors.js';

export interface AuthContext {
	user: { id: string; name: string };
}

export const API_KEY_HEADER = 'X-Api-Key';

export const apiKeyAuth = <
	TEvent extends APIGatewayProxyEventV2,
	TState extends { container: DependencyContainer<AuthService> },
	TRes,
>(): ResourceMiddleware<'auth', TEvent, TState, TRes, AuthContext> => {
	return resource('auth', {
		scope: 'request',
		init: async (request) => {
			const { event } = request;

			const authService = await request.state.container.get(AuthService);

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
				throw new UnauthorizedError('Invalid API key', {
					cause: err,
				});
			}

			return { user: { id: user.id, name: user.name } };
		},
	});
};
