import { lambda } from '@/builder.js';
import { layer } from '@/di/layer.js';
import {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { ApiErrorMapper } from 'examples/middlewares/api-error-mapper.js';
import { apiKeyAuth } from 'examples/middlewares/api-key-auth.js';
import { apiRequestValidator } from 'examples/middlewares/api-request-validator.js';
import { apiResponseSerializer } from 'examples/middlewares/api-response-serializer.js';
import { dependencyContainer } from 'examples/middlewares/dependency-container.js';
import { envVariableLoader } from 'examples/middlewares/env-variable-loader.js';
import { requestLogger } from 'examples/middlewares/request-logger.js';
import {
	secret,
	secretsFetcher,
} from 'examples/middlewares/secrets-fetcher.js';
import z from 'zod/v4';
import { AuthService } from './internal/auth.service.js';
import { logger } from './middlewares/logger.js';

const EnvSchema = z.object({
	ENCRYPTION_KEY_SECRET_ID: z.string(),
});

const RequestSchema = z.object({
	name: z.string(),
});

const ResponseSchema = z.object({
	message: z.string(),
});

const authLayer = layer<never, typeof AuthService, { encryptionKey: string }>(
	(container, { encryptionKey }) =>
		container.register(AuthService, () => new AuthService(encryptionKey))
);

export const handler = lambda<
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2
>()
	.use(logger())
	.useFactory((state) => requestLogger({ logger: state.logger }))
	.use(
		envVariableLoader({
			schema: EnvSchema,
		})
	)
	.useFactory((state) =>
		secretsFetcher({
			secrets: {
				encryptionKey: secret<string>(
					state.env.ENCRYPTION_KEY_SECRET_ID
				),
			},
		})
	)
	.use(new ApiErrorMapper())
	.useFactory((state) =>
		dependencyContainer(
			authLayer({ encryptionKey: state.secrets.encryptionKey.value() })
		)
	)
	.useFactory((state) => apiKeyAuth({ container: state.container }))
	.use(apiResponseSerializer({ schema: ResponseSchema }))
	.use(apiRequestValidator({ bodySchema: RequestSchema }))
	.handle((request) => {
		const _event = request.event;
		const _context = request.context;
		const _encryptionKey = request.state.secrets.encryptionKey.value();
		const _env = request.state.env;
		const _c = request.state.env;

		return {
			message: `Hello, ${request.state.request.body.name}!`,
		};
	});
