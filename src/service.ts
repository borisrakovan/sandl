import { DependencySpec, IContainer } from './container.js';
import { Layer, layer } from './layer.js';
import { AnyTag, ExtractInjectTag, ServiceTag, TagId } from './tag.js';

/**
 * Extracts constructor parameter types from a ServiceTag.
 * Only parameters that extend AnyTag are considered as dependencies.
 */
export type ConstructorParams<T extends ServiceTag<string | symbol, unknown>> =
	T extends new (...args: infer A) => unknown ? A : never;

/**
 * Helper to convert a tagged instance type back to its constructor type.
 * This uses the fact that tagged classes have a specific structure with TagId property.
 */
export type InstanceToConstructorType<T> = T extends {
	readonly [TagId]: infer Id;
}
	? Id extends string | symbol
		? ServiceTag<Id, T>
		: never
	: never;

/**
 * Extracts constructor-typed dependencies from constructor parameters.
 * Converts instance types to their corresponding constructor types.
 * Handles both ServiceTag dependencies (automatic) and ValueTag dependencies (via Inject helper).
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
 * Extracts only the dependency tags from a constructor's parameters for ServiceTag services,
 * or returns never for ValueTag services (which have no constructor dependencies).
 * This is used to determine what dependencies a service requires.
 */
export type ServiceDependencies<
	T extends ServiceTag<string | symbol, unknown>,
> =
	FilterTags<ConstructorParams<T>> extends AnyTag
		? FilterTags<ConstructorParams<T>>
		: never;

/**
 * Creates a service layer from any tag type (ServiceTag or ValueTag) with optional parameters.
 *
 * For ServiceTag services:
 * - Dependencies are automatically inferred from constructor parameters
 * - The factory function must handle dependency injection by resolving dependencies from the container
 *
 * For ValueTag services:
 * - No constructor dependencies are needed since they don't have constructors
 *
 * @template T - The tag representing the service (ServiceTag or ValueTag)
 * @param serviceClass - The tag (ServiceTag or ValueTag)
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
 * const userService = service(UserService, async (ctx) =>
 *   new UserService(await ctx.get(DatabaseService))
 * );
 * ```
 */
export function service<T extends ServiceTag<string | symbol, unknown>>(
	serviceClass: T,
	spec: DependencySpec<T, ServiceDependencies<T>>
): Layer<ServiceDependencies<T>, T> {
	return layer<ServiceDependencies<T>, T>(
		<TContainer extends AnyTag>(
			container: IContainer<TContainer | ServiceDependencies<T>>
		) => {
			return container.register(serviceClass, spec);
		}
	);
}
