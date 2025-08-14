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
export { Middleware, middleware } from './middleware.js';
export type { AnyMiddleware, MiddlewareName } from './middleware.js';

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
export {
	container,
	scopedContainer,
	type IContainer as DependencyContainer,
} from './di/container.js';
export { Layer, layer, type LayerFactory } from './di/layer.js';
export { service } from './di/service.js';
export type { Service } from './di/service.js';
export {
	Tag,
	type ServiceOf,
	type TaggedClass,
	type ValueTag,
} from './di/tag.js';
export type { Inject, Scope } from './di/types.js';
