import { lambda } from '@/builder.js';
import {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { apiErrorMapper } from 'examples/middlewares/api-error-mapper.js';
import { apiRequestValidator } from 'examples/middlewares/api-request-validator.js';
import { apiResponseSerializer } from 'examples/middlewares/api-response-serializer.js';
import { logger } from 'examples/middlewares/logger.js';
import z from 'zod/v4';
import { envVariableLoader } from './middlewares/env-variable-loader.js';
import { requestLogger } from './middlewares/request-logger.js';

const RequestSchema = z.object({
	name: z.string().min(1),
});

const ResponseSchema = z.object({
	message: z.string(),
});

const EnvSchema = z.object({
	AWS_REGION: z.string(),
});

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
	.use(apiErrorMapper())
	.use(apiResponseSerializer({ schema: ResponseSchema }))
	.use(apiRequestValidator({ bodySchema: RequestSchema }))
	.handle((request) => {
		// const a = request.state.request.body.name;
		const _event = request.event;
		const _context = request.context;
		const _env = request.state.env;
		// request.state.logger.

		return {
			message: `Hello, ${request.state.request.body.name}!`,
		};
	});
