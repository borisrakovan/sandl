import { lambda } from '@/builder.js';
import { layer } from '@/layer.js';
import {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { apiErrorMapper } from 'examples/api-error-mapper.js';
import { apiKeyAuth } from 'examples/api-key-auth.js';
import { apiRequestValidator } from 'examples/api-request-validator.js';
import { apiResponseSerializer } from 'examples/api-response-serializer.js';
import { dependencyContainer } from 'examples/dependency-container.js';
import { envVariableLoader } from 'examples/env-variable-loader.js';
import { AuthService } from 'examples/internal/auth.js';
import { logger } from 'examples/logger.js';
import { secret, secretsFetcher } from 'examples/secrets-fetcher.js';
import z from 'zod/v4';

const EnvSchema = z.object({
	ENCRYPTION_KEY_SECRET_ID: z.string(),
});

const RequestSchema = z.object({
	name: z.string(),
});

const ResponseSchema = z.object({
	message: z.string(),
});

export const handler = lambda<
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2
>()
	.use(
		envVariableLoader({
			schema: EnvSchema,
		})
	)
	.use(
		secretsFetcher({
			secrets: (env) => ({
				encryptionKey: secret<string>(env.ENCRYPTION_KEY_SECRET_ID),
			}),
		})
	)
	.use(logger())
	.use(apiErrorMapper())
	.use(
		dependencyContainer((_env, secrets) =>
			layer<never, AuthService>((container) =>
				container.register(
					AuthService,
					() => new AuthService(secrets.encryptionKey.value())
				)
			)
		)
	)
	.use(apiKeyAuth())
	.use(apiResponseSerializer({ schema: ResponseSchema }))
	.use(apiRequestValidator({ bodySchema: RequestSchema }))
	.handle((request) => {
		const _event = request.event;
		const _context = request.context;
		const _encryptionKey = request.state.secrets.encryptionKey.value();
		const _env = request.state.env;

		return {
			message: `Hello, ${request.state.request.body.name}!`,
		};
	});
