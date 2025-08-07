import { lambda } from '@/builder.js';
import { layer } from '@/layer.js';
import {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { apiErrorMapper } from 'examples/middlewares/api-error-mapper.js';
import { apiKeyAuth } from 'examples/middlewares/api-key-auth.js';
import { apiRequestValidator } from 'examples/middlewares/api-request-validator.js';
import { apiResponseSerializer } from 'examples/middlewares/api-response-serializer.js';
import { dependencyContainer } from 'examples/middlewares/dependency-container.js';
import { envVariableLoader } from 'examples/middlewares/env-variable-loader.js';
import { logger } from 'examples/middlewares/logger.js';
import {
	secret,
	secretsFetcher,
} from 'examples/middlewares/secrets-fetcher.js';
import z from 'zod/v4';
import { AuthService } from './internal/auth.service.js';

const EnvSchema = z.object({
	ENCRYPTION_KEY_SECRET_ID: z.string(),
});

const RequestSchema = z.object({
	name: z.string(),
});

const ResponseSchema = z.object({
	message: z.string(),
});

const authLayer = (encryptionKey: string) =>
	layer<never, AuthService>((container) =>
		container.register(AuthService, () => new AuthService(encryptionKey))
	); 

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
			authLayer(secrets.encryptionKey.value())
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
