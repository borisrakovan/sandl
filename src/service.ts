import { PromiseOrValue } from '@/types.js';
import { IContainer } from './container.js';
import { Layer, layer } from './layer.js';
import { AnyTag, ClassTag, ServiceOf, TaggedClass, TagId } from './tag.js';
import { ExtractInjectTag, Scope } from './types.js';

/**
 * Extracts constructor parameter types from a TaggedClass.
 * Only parameters that extend AnyTag are considered as dependencies.
 */
export type ConstructorParams<T extends ClassTag<unknown>> = T extends new (
	...args: infer A
) => unknown
	? A
	: never;

/**
 * Helper to convert a tagged instance type back to its constructor type.
 * This uses the fact that tagged classes have a specific structure with TagId property.
 */
export type InstanceToConstructorType<T> = T extends {
	readonly [TagId]: infer Id;
}
	? Id extends string | symbol
		? TaggedClass<T, Id>
		: never
	: never;

/**
 * Extracts constructor-typed dependencies from constructor parameters.
 * Converts instance types to their corresponding constructor types.
 * Handles both ClassTag dependencies (automatic) and ValueTag dependencies (via Inject helper).
 */
export type FilterTags<T extends readonly unknown[]> = T extends readonly []
	? never
	: {
			[K in keyof T]: T[K] extends {
				readonly [TagId]: string | symbol;
			}
				? InstanceToConstructorType<T[K]>
				: ExtractInjectTag<T[K]> extends never
					? never
					: ExtractInjectTag<T[K]>;
		}[number];

/**
 * Extracts the instance type that a TaggedClass constructor creates.
 */
export type ConstructorResult<T extends ClassTag<unknown>> = T extends new (
	...args: unknown[]
) => infer R
	? R
	: never;

/**
 * Extracts only the dependency tags from a constructor's parameters for ClassTag services,
 * or returns never for ValueTag services (which have no constructor dependencies).
 * This is used to determine what dependencies a service requires.
 */
export type ServiceDependencies<T extends AnyTag> =
	T extends ClassTag<unknown>
		? FilterTags<ConstructorParams<T>> extends AnyTag
			? FilterTags<ConstructorParams<T>>
			: never
		: never;

/**
 * Represents a service layer that can be created from any tag type.
 * For ClassTag services, dependencies are automatically inferred from constructor parameters.
 * For ValueTag services, there are no dependencies since they don't have constructors.
 */
export type Service<T extends AnyTag> = Layer<ServiceDependencies<T>, T>;

/**
 * Creates a service layer from any tag type (ClassTag or ValueTag) with optional parameters.
 *
 * For ClassTag services:
 * - Dependencies are automatically inferred from constructor parameters
 * - The factory function must handle dependency injection by resolving dependencies from the container
 *
 * For ValueTag services:
 * - No constructor dependencies are needed since they don't have constructors
 *
 * @template T - The tag representing the service (ClassTag or ValueTag)
 * @param serviceClass - The tag (ClassTag or ValueTag)
 * @param factory - Factory function for service instantiation with container
 * @returns The service layer
 *
 * @example Simple service without dependencies
 * ```typescript
 * class LoggerService extends Tag.Class('LoggerService') {
 *   log(message: string) { console.log(message); }
 * }
 *
 * const loggerService = service(LoggerService, () => new LoggerService());
 * ```
 *
 * @example Service with dependencies
 * ```typescript
 * class DatabaseService extends Tag.Class('DatabaseService') {
 *   query() { return []; }
 * }
 *
 * class UserService extends Tag.Class('UserService') {
 *   constructor(private db: DatabaseService) {
 *     super();
 *   }
 *
 *   getUsers() { return this.db.query(); }
 * }
 *
 * const userService = service(UserService, async (container) =>
 *   new UserService(await container.get(DatabaseService))
 * );
 * ```
 */
export function service<T extends AnyTag>(
	serviceClass: T,
	factory: <TScope extends Scope>(
		container: IContainer<ServiceDependencies<T>, TScope>
	) => PromiseOrValue<ServiceOf<T>>
): Service<T> {
	const serviceLayer = layer<ServiceDependencies<T>, T>(
		<TScope extends Scope>(
			container: IContainer<ServiceDependencies<T>, TScope>
		) => {
			return container.register(serviceClass, (c) => factory(c));
		}
	);

	// Create the service object that implements the Service interface
	const serviceImpl: Service<T> = {
		register: serviceLayer.register,
		to: serviceLayer.to,
		and: serviceLayer.and,
	};

	return serviceImpl;
}
