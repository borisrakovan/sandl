import { PromiseOrValue } from '@/types.js';
import { DependencyContainer } from './container.js';
import { AnyTag, ValueTag } from './tag.js';

/**
 * Unique symbol used to store the original ValueTag in Inject<T> types.
 * This prevents property name collisions while allowing type-level extraction.
 */
const InjectSource = Symbol('InjectSource');

/**
 * Generic interface representing a class constructor.
 *
 * This is primarily used internally for type constraints and validations.
 * Most users should use Tag.Class() instead of working with raw constructors.
 *
 * @template T - The type that the constructor creates
 * @internal
 */
export interface ClassConstructor<T = unknown> {
	readonly name: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	new (...args: any[]): T;
}

/**
 * Type representing a factory function used to create dependency instances.
 *
 * Factory functions are the core mechanism for dependency creation in the DI system.
 * They receive a dependency container and can use it to resolve other dependencies
 * that the service being created needs.
 *
 * The factory can be either synchronous (returning T directly) or asynchronous
 * (returning Promise<T>). The container handles both cases transparently.
 *
 * @template T - The type of the service instance being created
 * @template TReg - Union type of all dependencies available in the container
 *
 * @example Synchronous factory
 * ```typescript
 * const factory: Factory<DatabaseService, never> = (container) => {
 *   return new DatabaseService('sqlite://memory');
 * };
 * ```
 *
 * @example Asynchronous factory with dependencies
 * ```typescript
 * const factory: Factory<UserService, typeof ConfigTag | typeof DatabaseService> = async (container) => {
 *   const [config, db] = await Promise.all([
 *     container.get(ConfigTag),
 *     container.get(DatabaseService)
 *   ]);
 *   return new UserService(config, db);
 * };
 * ```
 */
export type Factory<T, TReg extends AnyTag, TScope extends Scope> = (
	container: DependencyContainer<TReg, TScope>
) => PromiseOrValue<T>;

/**
 * Helper type for injecting ValueTag dependencies in constructor parameters.
 * This allows clean specification of ValueTag dependencies while preserving
 * the original tag information for dependency inference.
 *
 * The phantom property is optional to allow normal runtime values to be assignable.
 *
 * @template T - A ValueTag type
 * @returns The value type with optional phantom tag metadata for dependency inference
 *
 * @example
 * ```typescript
 * const ApiKeyTag = Tag.of('apiKey')<string>();
 *
 * class UserService extends Tag.Class('UserService') {
 *   constructor(
 *     private db: DatabaseService,        // ClassTag - works automatically
 *     private apiKey: Inject<typeof ApiKeyTag>  // ValueTag - type is string, tag preserved
 *   ) {
 *     super();
 *   }
 * }
 * ```
 */
export type Inject<T extends ValueTag<unknown, string | symbol>> =
	T extends ValueTag<infer V, string | symbol>
		? V & { readonly [InjectSource]?: T }
		: never;

/**
 * Helper type to extract the original ValueTag from an Inject<T> type.
 * Since InjectSource is optional, we need to check for both presence and absence.
 * @internal
 */
export type ExtractInjectTag<T> = T extends {
	readonly [InjectSource]?: infer U;
}
	? U
	: never;

/**
 * Type representing a finalizer function used to clean up dependency instances.
 *
 * Finalizers are optional cleanup functions that are called when the container
 * is destroyed via `container.destroy()`. They receive the created instance
 * and should perform any necessary cleanup (closing connections, releasing resources, etc.).
 *
 * Like factories, finalizers can be either synchronous or asynchronous.
 * All finalizers are called concurrently during container destruction.
 *
 * @template T - The type of the service instance being finalized
 *
 * @example Synchronous finalizer
 * ```typescript
 * const finalizer: Finalizer<FileHandle> = (fileHandle) => {
 *   fileHandle.close();
 * };
 * ```
 *
 * @example Asynchronous finalizer
 * ```typescript
 * const finalizer: Finalizer<DatabaseConnection> = async (connection) => {
 *   await connection.disconnect();
 * };
 * ```
 *
 * @example Resilient finalizer
 * ```typescript
 * const finalizer: Finalizer<HttpServer> = async (server) => {
 *   try {
 *     await server.close();
 *   } catch (error) {
 *     if (!error.message.includes('already closed')) {
 *       throw error; // Re-throw unexpected errors
 *     }
 *     // Ignore "already closed" errors
 *   }
 * };
 * ```
 */
export type Finalizer<T> = (instance: T) => PromiseOrValue<void>;

export type Scope = string | symbol;

export const DefaultScope: unique symbol = Symbol('default');
export type DefaultScope = typeof DefaultScope;
