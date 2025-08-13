import { Middleware, NextFunction } from '@/middleware.js';
import { LambdaRequest, State } from '@/types.js';
import {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ApiError, InternalServerError } from '../internal/errors.js';
import { errorResponse } from '../internal/responses.js';

export class ApiErrorMapper<
	TEvent extends APIGatewayProxyEventV2,
	TState extends State,
> extends Middleware<
	'apiErrorMapper',
	TEvent,
	TState,
	TState,
	APIGatewayProxyStructuredResultV2,
	APIGatewayProxyStructuredResultV2
> {
	constructor() {
		super('apiErrorMapper');
	}

	async execute(
		request: LambdaRequest<TEvent, TState>,
		next: NextFunction<TEvent, TState, APIGatewayProxyStructuredResultV2>
	): Promise<APIGatewayProxyStructuredResultV2> {
		try {
			return await next(request);
		} catch (error) {
			if (error instanceof ApiError) {
				return errorResponse(error.statusCode, {
					message: error.message,
					detail: error.detail,
				});
			}

			const internalError = new InternalServerError(
				'Internal server error',
				{ cause: error }
			);

			return errorResponse(internalError.statusCode, {
				message: internalError.message,
				detail: internalError.detail,
			});
		}
	}
}

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
> => new ApiErrorMapper<TEvent, TState>();
