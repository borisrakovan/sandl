import { AwsContext } from '@/types.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './hello-world-api-handler.js';

const context = {} as AwsContext;

const mockEvent = (name: string) =>
	({
		httpMethod: 'POST',
		path: '/',
		body: JSON.stringify({ name }),
	}) as unknown as APIGatewayProxyEventV2;

describe('api.handler', () => {
	it('should return a 200 response for valid name', async () => {
		const result = await handler
			.test()
			.execute(mockEvent('John Doe'), context);

		expect(result.statusCode).toBe(200);
		expect(JSON.parse(result.body ?? '{}')).toEqual({
			message: 'Hello, John Doe!',
		});
	});

	it('should return a 400 response for invalid name', async () => {
		const result = await handler
			.test()
			// Pass an empty string as the name
			.execute(mockEvent(''), context);

		expect(result.statusCode).toBe(400);

		// The validation error was serialized as a JSON error object
		// thanks to the apiErrorMapper middleware
		expect(JSON.parse(result.body ?? '{}')).toMatchObject({
			error: {
				message: 'Validation failed for message body',
			},
		});
	});
});
