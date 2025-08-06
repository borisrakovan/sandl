import { middleware, Middleware } from '@/middleware.js';
import { State } from '@/types.js';
import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod/v4';
import { ApiErrorOptions, InternalServerError } from './internal/errors.js';
import { jsonResponse } from './internal/responses.js';

export type ApiResponseSerializerOptions<TSchema extends z.ZodType> = {
	schema: TSchema;
};

export class ResponseSerializationError extends InternalServerError {
	constructor(options: Omit<ApiErrorOptions, 'statusCode'> = {}) {
		super('Invalid API response', options);
	}
}

export const apiResponseSerializer = <
	TEvent,
	TState extends State,
	TRes,
	TSchema extends z.ZodType,
>(
	options: ApiResponseSerializerOptions<TSchema>
): Middleware<
	'apiResponseSerializer',
	TEvent,
	TState,
	TState,
	TRes,
	APIGatewayProxyStructuredResultV2
> => {
	return middleware('apiResponseSerializer', async (request, next) => {
		const response = await next(request);

		let validated;
		try {
			validated = options.schema.parse(response) as Record<
				string,
				unknown
			>;
		} catch (err) {
			throw new ResponseSerializationError({ cause: err });
		}

		return jsonResponse(validated);
	});
};
