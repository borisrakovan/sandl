import { PromiseOrValue } from '@/types.js';
import { DependencyContainer } from './container.js';
import { DependencyLayer, layer } from './layer.js';
import { AnyTag, ClassTag, ServiceOf, TaggedClass, TagId } from './tag.js';
import { ExtractInjectTag } from './types.js';

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
export interface Service<T extends AnyTag>
	extends DependencyLayer<ServiceDependencies<T>, T> {
	/**
	 * The tag that this service represents (ClassTag or ValueTag)
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
/**
 * Creates a service layer from any tag type with optional parameters.
 *
 * This function follows the same pattern as layer() - always returning a factory function
 * for API consistency, supporting both automatic dependency inference and optional parameters.
 *
 * For ClassTag services, dependencies are automatically inferred from constructor parameters.
 * For ValueTag services, there are no dependencies since they don't have constructors.
 *
 * @template T - The tag representing the service (ClassTag or ValueTag)
 * @template TParams - Optional parameters for service configuration
 * @param serviceClass - The tag (ClassTag or ValueTag)
 * @param factory - Factory function for service instantiation
 * @returns Service factory function
 */
export function service<T extends AnyTag, TParams = undefined>(
	serviceClass: T,
	factory: (
		container: DependencyContainer<ServiceDependencies<T>>,
		params: TParams
	) => PromiseOrValue<ServiceOf<T>>
): TParams extends undefined
	? () => Service<T>
	: (params: TParams) => Service<T> {
	const serviceFactory = (params?: TParams) => {
		const serviceLayer = layer<ServiceDependencies<T>, T>((container) => {
			return container.register(serviceClass, (c) =>
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				factory(c, params as TParams)
			);
		})();

		// Create the service object that implements the Service interface
		const serviceImpl: Service<T> = {
			serviceClass,
			register: serviceLayer.register,
			to: serviceLayer.to,
			and: serviceLayer.and,
		};

		return serviceImpl;
	};

	return serviceFactory as TParams extends undefined
		? () => Service<T>
		: (params: TParams) => Service<T>;
}
/*  */
