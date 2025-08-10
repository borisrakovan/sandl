import { DependencyContainer } from './container.js';
import { DependencyLayer, layer } from './layer.js';
import { ClassTag, ServiceOf, TaggedClass } from './tag.js';

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
 * This uses the fact that tagged classes have a specific structure with __tag_id__.
 */
type InstanceToConstructorType<T> = T extends { readonly __tag_id__: infer Id }
	? Id extends string | symbol
		? TaggedClass<T, Id>
		: never
	: never;

/**
 * Extracts constructor-typed dependencies from constructor parameters.
 * Converts instance types to their corresponding constructor types.
 */
export type FilterTags<T extends readonly unknown[]> = T extends readonly []
	? never
	: {
			[K in keyof T]: T[K] extends {
				readonly __tag_id__: string | symbol;
			}
				? InstanceToConstructorType<T[K]>
				: never;
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
 * Extracts only the dependency tags from a constructor's parameters.
 * This is used to determine what dependencies a service requires.
 */
export type ServiceDependencies<T extends ClassTag<unknown>> = FilterTags<
	ConstructorParams<T>
>;

/**
 * Represents a service layer that derives its dependencies from a TaggedClass constructor.
 * This allows creating a layer from a single service class where dependencies are
 * automatically inferred from the constructor parameters.
 */
export interface Service<T extends ClassTag<unknown>>
	extends DependencyLayer<ServiceDependencies<T>, T> {
	/**
	 * The TaggedClass that this service represents
	 */
	readonly serviceClass: T;
}

/**
 * Creates a service layer from a ClassTag constructor.
 *
 * This function automatically derives the dependency requirements from the constructor
 * parameters and creates a layer that provides the service. The factory function must
 * handle dependency injection manually by resolving dependencies from the container.
 *
 * @template T - The ClassTag representing the service
 * @param serviceClass - The ClassTag constructor
 * @param factory - Factory function for custom instantiation logic with manual dependency injection
 * @returns A service layer that provides the given service class
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
export function service<T extends ClassTag<unknown>>(
	serviceClass: T,
	factory: (
		container: DependencyContainer<ServiceDependencies<T>>
	) => Promise<ServiceOf<T>> | ServiceOf<T>
): Service<T> {
	const serviceLayer = layer<ServiceDependencies<T>, T>((container) => {
		return container.register(serviceClass, factory);
	})();

	// Create the service object that implements the Service interface
	const serviceImpl: Service<T> = {
		serviceClass,
		register: serviceLayer.register,
		to: serviceLayer.to,
		and: serviceLayer.and,
	};

	return serviceImpl;
}
