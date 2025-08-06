import { AwsContext } from '@/types.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SecretValue } from 'examples/internal/secret-value.js';
import { describe, expect, it } from 'vitest';
import { handler } from './api.js';

const event = {
	httpMethod: 'POST',
	path: '/',
	body: JSON.stringify({ name: 'John Doe' }),
} as unknown as APIGatewayProxyEventV2;

const context = {} as AwsContext;

describe('api.handler', () => {
	it('should return a 200 response', async () => {
		const result = await handler
			.test()
			.skipMiddleware('auth')
			.withMiddleware('env', (request, next) =>
				next({
					...request,
					state: {
						...request.state,
						env: {
							ENCRYPTION_KEY_SECRET_ID: 'test',
						},
					},
				})
			)
			.withResource('secrets', {
				scope: 'runtime',
				init: () => ({
					encryptionKey: new SecretValue('test'),
				}),
			})
			.execute(event, context);

		console.log(result);
		expect(result.statusCode).toBe(200);
	});
});
