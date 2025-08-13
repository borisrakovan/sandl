import { RuntimeResource, type ResourceMiddleware } from '@/resource.js';
import { State } from '@/types.js';
import { SecretValue } from 'examples/internal/secret-value.js';
import { z } from 'zod/v4';
import * as secretsManager from '../internal/secrets-manager.js';

// We need this to let the caller conveniently define the type of the returned secret
// e.g. secret<string>('secret-name')
export type SecretSpec<TSchema extends z.ZodType> = {
	id: string;
	schema?: TSchema;
};

export type SecretsSpec = Record<string, SecretSpec<z.ZodType>>;

export type SecretsFetcherOptions<TSpec extends SecretsSpec> = {
	// Mapping of internal key name to AWS SM request parameter SecretId (can be secret name or secret ARN)
	secrets: TSpec;
	getSecretValue?: typeof secretsManager.getSecretValue;
};

export type SecretsFetcherState<TSpec extends SecretsSpec> = {
	[K in keyof TSpec]: TSpec[K] extends SecretSpec<infer T>
		? SecretValue<z.infer<T>>
		: never;
};

export const secret = <
	TSecret,
	TSchema extends z.ZodType<TSecret> = z.ZodType<TSecret>,
>(
	id: string,
	schema?: TSchema
): SecretSpec<TSchema> => {
	return { id, schema } as SecretSpec<TSchema>;
};

export class SecretsFetcher<
	TEvent,
	TRes,
	TState extends State,
	TSpec extends SecretsSpec,
> extends RuntimeResource<
	'secrets',
	TEvent,
	TState,
	TRes,
	SecretsFetcherState<TSpec>
> {
	constructor(private readonly options: SecretsFetcherOptions<TSpec>) {
		super('secrets');
	}

	protected async init() {
		const getSecretValueFn =
			this.options.getSecretValue ?? secretsManager.getSecretValue;

		const secretValues = await Promise.all(
			Object.values(this.options.secrets).map((secret) =>
				getSecretValueFn(secret.id, secret.schema).then(
					(value) => new SecretValue(value)
				)
			)
		);

		return Object.fromEntries(
			Object.keys(this.options.secrets).map((key, idx) => [
				key,
				secretValues[idx],
			])
		) as SecretsFetcherState<TSpec>;
	}
}

export function secretsFetcher<
	TEvent,
	TRes,
	TState extends State,
	TSpec extends SecretsSpec,
>(
	options: SecretsFetcherOptions<TSpec>
): ResourceMiddleware<
	'secrets',
	TEvent,
	TState,
	TRes,
	SecretsFetcherState<TSpec>
> {
	return new SecretsFetcher<TEvent, TRes, TState, TSpec>(options);
}
