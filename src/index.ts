// Core builder and handler exports
export { LambdaBuilder, lambda } from './builder.js';
export type { LambdaHandler } from './handler.js';

// Core types
export type {
	AwsContext,
	LambdaRequest,
	PromiseOrValue,
	State,
} from './types.js';

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

// Middleware test utilities
export type { LambdaTestBuilder } from './test-builder.js';

// Dependency container and layer exports
export { DependencyContainer, container } from './di/container.js';
export { Layer, layer } from './di/layer.js';
export type { DependencyLayer } from './di/layer.js';
export { service } from './di/service.js';
export type { Service } from './di/service.js';
export type { Inject } from './di/types.js';
export {
	Tag,
	type ServiceOf,
	type TaggedClass,
	type ValueTag,
} from './di/tag.js';
