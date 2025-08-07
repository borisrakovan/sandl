import { resource, ResourceMiddleware } from '@/resource.js';
import { State } from '@/types.js';
import { jsonParse } from '@/utils/json.js';
import { getKey } from '@/utils/object.js';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod/v4';
import { ValidationError } from '../internal/errors.js';

export type ApiRequestValidatorOptions<
	TBody extends z.ZodType | undefined,
	TPath extends z.ZodType | undefined,
	TQuery extends z.ZodType | undefined,
> = {
	bodySchema?: TBody;
	pathSchema?: TPath;
	querySchema?: TQuery;
};

type OptionallyParsed<T extends z.ZodType | undefined> = T extends undefined
	? undefined
	: z.infer<T>;

export type ApiRequestValidatorState<
	TBody extends z.ZodType | undefined,
	TPath extends z.ZodType | undefined,
	TQuery extends z.ZodType | undefined,
> = {
	body: OptionallyParsed<TBody>;
	path: OptionallyParsed<TPath>;
	query: OptionallyParsed<TQuery>;
};

export const apiRequestValidator = <
	TEvent extends APIGatewayProxyEventV2,
	TState extends State,
	TRes,
	TBody extends z.ZodType | undefined,
	TPath extends z.ZodType | undefined,
	TQuery extends z.ZodType | undefined,
>(
	options: ApiRequestValidatorOptions<TBody, TPath, TQuery>
): ResourceMiddleware<
	'request',
	TEvent,
	TState,
	TRes,
	ApiRequestValidatorState<TBody, TPath, TQuery>
> => {
	return resource('request', {
		scope: 'request',
		init: (request) => {
			const { bodySchema, pathSchema, querySchema } = options;

			const { event } = request;

			// Validate path parameters
			let parsedPath;
			if (pathSchema !== undefined) {
				try {
					parsedPath = pathSchema.parse(
						event.pathParameters ?? {}
					) as z.infer<typeof pathSchema>;
				} catch (err) {
					if (err instanceof z.ZodError) {
						throw new ValidationError(`Invalid path parameters`, {
							cause: err,
							detail: {
								value: event.pathParameters ?? null,
								issues: err.issues,
							},
						});
					}
					throw err;
				}
			}

			// Validate query parameters
			let parsedQuery;
			if (querySchema !== undefined) {
				try {
					parsedQuery = querySchema.parse(
						event.queryStringParameters ?? {}
					) as z.infer<typeof querySchema>;
				} catch (err) {
					if (err instanceof z.ZodError) {
						throw new ValidationError(
							`Received invalid query parameters`,
							{
								cause: err,
								detail: {
									value: event.queryStringParameters ?? null,
									issues: err.issues,
								},
							}
						);
					}
					throw err;
				}
			}

			// Validate body
			let parsedBody;
			if (bodySchema !== undefined) {
				let jsonBody;
				try {
					// Parse the message body from string to JSON
					jsonBody = jsonParse(event.body ?? 'null');
				} catch (err) {
					throw new ValidationError(`Invalid JSON body format`, {
						cause: err,
						detail: {
							message: getKey(err, 'message'),
						},
					});
				}

				try {
					// Now validate the parsed JSON object with zod
					parsedBody = bodySchema.parse(jsonBody) as z.infer<TBody>;
				} catch (err) {
					if (err instanceof z.ZodError) {
						throw new ValidationError(
							`Validation failed for message body`,
							{
								cause: err,
								detail: {
									issues: err.issues,
								},
							}
						);
					}
					throw err;
				}
			}

			return {
				body: parsedBody as OptionallyParsed<TBody>,
				path: parsedPath as OptionallyParsed<TPath>,
				query: parsedQuery as OptionallyParsed<TQuery>,
			};
		},
	});
};
