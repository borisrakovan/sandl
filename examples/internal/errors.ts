import { BaseError, ErrorProps as BaseErrorOptions } from '@/errors.js';

export interface ApiErrorOptions extends BaseErrorOptions {
	statusCode: number;
}

export class ApiError extends BaseError {
	readonly statusCode: number;

	constructor(message: string, options: ApiErrorOptions) {
		super(message, options);
		this.statusCode = options.statusCode;
	}
}

export class ValidationError extends ApiError {
	constructor(
		message: string,
		options: Omit<ApiErrorOptions, 'statusCode'> = {}
	) {
		super(message, { ...options, statusCode: 400 });
	}
}

export class InternalServerError extends ApiError {
	constructor(
		message = 'Internal server error',
		options: Omit<ApiErrorOptions, 'statusCode'> = {}
	) {
		super(message, { ...options, statusCode: 500 });
	}
}

export class NotFoundError extends ApiError {
	constructor(
		message: string,
		options: Omit<ApiErrorOptions, 'statusCode'> = {}
	) {
		super(message, { ...options, statusCode: 404 });
	}
}

export class UnauthorizedError extends ApiError {
	constructor(
		message: string,
		options: Omit<ApiErrorOptions, 'statusCode'> = {}
	) {
		super(message, { ...options, statusCode: 401 });
	}
}

export class BadRequestError extends ApiError {
	constructor(
		message: string,
		options: Omit<ApiErrorOptions, 'statusCode'> = {}
	) {
		super(message, { ...options, statusCode: 400 });
	}
}
