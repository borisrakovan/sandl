import { BaseError } from '@/errors.js';
import { resource, ResourceMiddleware } from '@/resource.js';
import { State } from '@/types.js';
import { z } from 'zod/v4';

export class EnvVariableLoaderError extends BaseError {}

export type EnvVariableLoaderOptions<TSchema extends z.ZodType> = {
	schema: TSchema;
	env?: NodeJS.ProcessEnv;
};

export const envVariableLoader = <
	TEvent,
	TRes,
	TState extends State,
	TEnvSchema extends z.ZodType<TEnv>,
	TEnv,
>(
	options: EnvVariableLoaderOptions<TEnvSchema>
): ResourceMiddleware<'env', TEvent, TState, TRes, z.infer<TEnvSchema>> => {
	return resource('env', {
		scope: 'runtime',
		init: () => {
			// Read environment variables and validate using the provided Zod schema
			try {
				return options.schema.parse(options.env ?? process.env);
			} catch (err) {
				throw new EnvVariableLoaderError(
					'Invalid environment variables',
					{
						cause: err,
					}
				);
			}
		},
	});
};
