import { RuntimeResource, type ResourceMiddleware } from '@/resource.js';
import { LambdaRequest, State } from '@/types.js';
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

export type SecretsFetcherOptions<TSpec extends SecretsSpec, TEnv> = {
	// Mapping of internal key name to AWS SM request parameter SecretId (can be secret name or secret ARN)
	secrets: TSpec | ((env: TEnv) => TSpec);
	getSecretValue?: typeof secretsManager.getSecretValue;
};

export type SecretsFetcherState<TSpec extends SecretsSpec> = {
	[K in keyof TSpec]: TSpec[K] extends SecretSpec<infer T>
		? SecretValue<z.infer<T>>
		: never;
};

type EnvFromState<TState> = TState extends { env: infer TEnv } ? TEnv : unknown;

export const secret = <
	TSecret,
	TSchema extends z.ZodType<TSecret> = z.ZodType<TSecret>,
>(
	id: string,
	schema?: TSchema
): SecretSpec<TSchema> => {
	return { id, schema } as SecretSpec<TSchema>;
};

class SecretsFetcher<
	TEvent,
	TRes,
	TState extends State,
	TSpec extends SecretsSpec,
> extends RuntimeResource<'secrets', TEvent, TState, TRes, SecretsFetcherState<TSpec>> {
	constructor(
		private readonly options: SecretsFetcherOptions<TSpec, EnvFromState<TState>>
	) {
		super('secrets');
	}

	protected async init(request: LambdaRequest<TEvent, TState>) {
		const secrets =
			typeof this.options.secrets === 'function'
				? this.options.secrets(request.state.env as EnvFromState<TState>)
				: this.options.secrets;

		const getSecretValueFn =
			this.options.getSecretValue ?? secretsManager.getSecretValue;

		const secretValues = await Promise.all(
			Object.values(secrets).map((secret) =>
				getSecretValueFn(secret.id, secret.schema).then(
					(value) => new SecretValue(value)
				)
			)
		);

		return Object.fromEntries(
			Object.keys(secrets).map((key, idx) => [key, secretValues[idx]])
		) as SecretsFetcherState<TSpec>;
	}
}

export function secretsFetcher<
	TEvent,
	TRes,
	TState extends State,
	TSpec extends SecretsSpec,
>(
	options: SecretsFetcherOptions<TSpec, EnvFromState<TState>>
): ResourceMiddleware<'secrets', TEvent, TState, TRes, SecretsFetcherState<TSpec>> {
	return new SecretsFetcher<TEvent, TRes, TState, TSpec>(options);
}
