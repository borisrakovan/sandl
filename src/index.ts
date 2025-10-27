export { Container, container } from './container.js';
export type {
	DependencyLifecycle,
	Factory,
	Finalizer,
	IContainer,
	ResolutionContext,
} from './container.js';
export {
	CircularDependencyError,
	ContainerDestroyedError,
	ContainerError,
	DependencyAlreadyInstantiatedError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from './errors.js';
export { Layer, layer } from './layer.js';
export type { AnyLayer } from './layer.js';
export { ScopedContainer, scoped } from './scoped-container.js';
export type { Scope } from './scoped-container.js';
export { service } from './service.js';
export type { Service } from './service.js';
export {
	Tag,
	type AnyTag,
	type ClassTag,
	type Inject,
	type TagType,
	type TaggedClass,
	type ValueTag,
} from './tag.js';
export type {
	ClassConstructor,
	JsonObject,
	JsonValue,
	PromiseOrValue,
} from './types.js';
export { value } from './value.js';
