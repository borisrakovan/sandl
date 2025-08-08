// Core builder and handler exports
export { LambdaBuilder, lambda } from './builder.js';
export type { LambdaHandler } from './handler.js';

// Dependency container and layer exports
export {
	DependencyContainer,
	DependencyContainerError,
	DependencyContainerFinalizationError,
	DependencyCreationError,
	UnknownDependencyError,
} from './di/container.js';

export { layer } from './layer.js';
export type { DependencyLayer } from './layer.js';

// Middleware exports
export { middleware } from './middleware.js';
export type {
	AnyMiddleware,
	Middleware,
	MiddlewareName,
} from './middleware.js';

// Resource management exports
export { resource } from './resource.js';
export type {
	ResourceMiddleware,
	ResourceScope,
	ResourceSpec,
} from './resource.js';

// Test utilities
export type { LambdaTestBuilder } from './test-builder.js';

// Error handling
export { BaseError } from './errors.js';
export type { ErrorDump, ErrorProps } from './errors.js';

// Core types
export type {
	AwsContext,
	ClassConstructor,
	JsonObject,
	JsonValue,
	LambdaRequest,
	Prettify,
	PromiseOrValue,
	State,
} from './types.js';
