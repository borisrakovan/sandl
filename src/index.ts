export { container, Container } from './container.js';
export type { IContainer, DependencyLifecycle } from './container.js';
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
export { scoped, ScopedContainer } from './scoped-container.js';
export { service } from './service.js';
export type { Service } from './service.js';
export { Tag, type TagType, type TaggedClass, type ValueTag, type AnyTag, type ClassTag } from './tag.js';
export type { 
	Inject, 
	Factory, 
	Finalizer, 
	Scope, 
	ResolutionContext,
	PromiseOrValue
} from './types.js';
export { value } from './value.js';
