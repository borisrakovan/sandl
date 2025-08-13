import { Middleware, NextFunction } from '@/middleware.js';
import { LambdaRequest, State } from '@/types.js';
import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod/v4';
import { ApiErrorOptions, InternalServerError } from '../internal/errors.js';
import { jsonResponse } from '../internal/responses.js';

export type ApiResponseSerializerOptions<TSchema extends z.ZodType> = {
	schema: TSchema;
};

export class ResponseSerializationError extends InternalServerError {
	constructor(options: Omit<ApiErrorOptions, 'statusCode'> = {}) {
		super('Invalid API response', options);
	}
}

class ApiResponseSerializer<
	TEvent,
	TState extends State,
	TRes,
	TSchema extends z.ZodType,
> extends Middleware<
	'apiResponseSerializer',
	TEvent,
	TState,
	TState,
	TRes,
	APIGatewayProxyStructuredResultV2
> {
	constructor(
		private readonly options: ApiResponseSerializerOptions<TSchema>
	) {
		super('apiResponseSerializer');
	}

	async apply(
		request: LambdaRequest<TEvent, TState>,
		next: NextFunction<TEvent, TState, TRes>
	): Promise<APIGatewayProxyStructuredResultV2> {
		const response = await next(request);

		let validated: Record<string, unknown>;
		try {
			validated = this.options.schema.parse(response) as Record<
				string,
				unknown
			>;
		} catch (err) {
			throw new ResponseSerializationError({ cause: err });
		}

		return jsonResponse(validated);
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
> => new ApiResponseSerializer<TEvent, TState, TRes, TSchema>(options);
