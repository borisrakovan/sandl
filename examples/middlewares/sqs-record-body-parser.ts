import { BaseError } from '@/errors.js';
import { Middleware, NextFunction } from '@/middleware.js';
import { ResourceMiddleware } from '@/resource.js';
import { LambdaRequest, PromiseOrValue, State } from '@/types.js';
import { jsonParse } from '@/utils/json.js';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { z } from 'zod/v4';

export class SqsRecordBodyParserError extends BaseError {}

export type SqsRecordBodyParserOptions<TSchema extends z.ZodType> = {
	schema: TSchema;
};

export type ParsedRecord<TSchema extends z.ZodType> = Omit<
	SQSRecord,
	'body'
> & {
	body: z.infer<TSchema>;
};

export type SqsRecordBodyParserState<TSchema extends z.ZodType> =
	ParsedRecord<TSchema>[];

class SqsRecordBodyParser<
	TEvent extends SQSEvent,
	TRes,
	TState extends State,
	TSchema extends z.ZodType,
> extends Middleware<
	'parsedRecords',
	TEvent,
	TState,
	TState & { parsedRecords: SqsRecordBodyParserState<TSchema> },
	TRes,
	TRes
> {
	constructor(private readonly options: SqsRecordBodyParserOptions<TSchema>) {
		super('parsedRecords');
	}

	apply(
		request: LambdaRequest<TEvent, TState>,
		next: NextFunction<
			TEvent,
			TState & { parsedRecords: SqsRecordBodyParserState<TSchema> },
			TRes
		>
	): PromiseOrValue<TRes> {
		const { event } = request;
		const { schema } = this.options;

		const parsedRecords = event.Records.map((record) => {
			const messageBody = record.body;

			let jsonBody: unknown;
			try {
				jsonBody = jsonParse(messageBody);
			} catch (err) {
				throw new SqsRecordBodyParserError(`Invalid JSON body format`, {
					cause: err,
					detail: { messageBody },
				});
			}

			let parsedBody: unknown;
			try {
				parsedBody = schema.parse(jsonBody);
			} catch (err) {
				throw new SqsRecordBodyParserError(
					`Validation failed for message body`,
					{ cause: err, detail: { jsonBody } }
				);
			}

			return { ...record, body: parsedBody } as ParsedRecord<TSchema>;
		});

		return next({
			...request,
			state: { ...request.state, parsedRecords },
		});
	}
}

export const sqsRecordBodyParser = <
	TEvent extends SQSEvent,
	TRes,
	TState extends State,
	TSchema extends z.ZodType,
>(
	options: SqsRecordBodyParserOptions<TSchema>
): ResourceMiddleware<
	'parsedRecords',
	TEvent,
	TState,
	TRes,
	SqsRecordBodyParserState<TSchema>
> => new SqsRecordBodyParser<TEvent, TRes, TState, TSchema>(options);
