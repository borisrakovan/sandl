import { BaseError } from '@/errors.js';
import { resource, ResourceMiddleware } from '@/resource.js';
import { State } from '@/types.js';
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
> => {
	return resource('parsedRecords', {
		scope: 'request',
		init: (request) => {
			const { event } = request;
			const { schema } = options;

			const parsedRecords = event.Records.map((record) => {
				const messageBody = record.body;

				let jsonBody;
				try {
					// Parse the message body from string to JSON
					jsonBody = jsonParse(messageBody);
				} catch (err) {
					throw new SqsRecordBodyParserError(
						`Invalid JSON body format`,
						{
							cause: err,
							detail: { messageBody },
						}
					);
				}

				let parsedBody;
				try {
					// Now validate the parsed JSON object with zod
					parsedBody = schema.parse(jsonBody);
				} catch (err) {
					throw new SqsRecordBodyParserError(
						`Validation failed for message body`,
						{ cause: err, detail: { jsonBody } }
					);
				}

				return {
					...record,
					body: parsedBody,
				};
			});

			return parsedRecords;
		},
	});
};
