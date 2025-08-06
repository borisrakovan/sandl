import { middleware, Middleware } from '@/middleware.js';
import { State } from '@/types.js';
import {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ApiError, InternalServerError } from './internal/errors.js';
import { errorResponse } from './internal/responses.js';

export const apiErrorMapper = <
	TEvent extends APIGatewayProxyEventV2,
	TState extends State,
>(): Middleware<
	'apiErrorMapper',
	TEvent,
	TState,
	TState,
	APIGatewayProxyStructuredResultV2,
	APIGatewayProxyStructuredResultV2
> => {
	return middleware('apiErrorMapper', async (request, next) => {
		try {
			return await next(request);
		} catch (error) {
			// If it's an API error, we can expose its details
			if (error instanceof ApiError) {
				return errorResponse(error.statusCode, {
					message: error.message,
					detail: error.detail,
				});
			}

			// For all other errors, return a generic 500 response
			const internalError = new InternalServerError(
				'Internal server error',
				{
					cause: error,
				}
			);

			return errorResponse(internalError.statusCode, {
				message: internalError.message,
				detail: internalError.detail,
			});
		}
	});
};
