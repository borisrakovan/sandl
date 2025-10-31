export { Container } from './container.js';
export type {
	DependencyLifecycle,
	DependencySpec,
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
export {
	InjectSource,
	Tag,
	type AnyTag,
	type ServiceTag,
	type Inject,
	type TagType,
	type ValueTag,
} from './tag.js';
export type { PromiseOrValue } from './types.js';
export { value } from './value.js';
