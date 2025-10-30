import { Container, DependencySpec, IContainer } from './container.js';
import {
	ContainerDestroyedError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from './errors.js';
import { AnyTag, TagType } from './tag.js';

export type Scope = string | symbol;

export class ScopedContainer<
	TReg extends AnyTag = never,
> extends Container<TReg> {
	public readonly scope: Scope;

	private parent: IContainer<TReg> | null;
	private readonly children: WeakRef<ScopedContainer<TReg>>[] = [];

	constructor(parent: IContainer<TReg> | null, scope: Scope) {
		super();
		this.parent = parent;
		this.scope = scope;
	}

	/**
	 * Registers a dependency in the scoped container.
	 *
	 * Overrides the base implementation to return ScopedContainer type
	 * for proper method chaining support.
	 */
	override register<T extends AnyTag>(
		tag: T,
		spec: DependencySpec<T, TReg>
	): ScopedContainer<TReg | T> {
		super.register(tag, spec);
		return this as ScopedContainer<TReg | T>;
	}

	/**
	 * Checks if a dependency has been registered in this scope or any parent scope.
	 *
	 * This method checks the current scope first, then walks up the parent chain.
	 * Returns true if the dependency has been registered somewhere in the scope hierarchy.
	 */
	override has(tag: AnyTag): boolean {
		// Check current scope first
		if (super.has(tag)) {
			return true;
		}

		// Check parent scopes
		return this.parent?.has(tag) ?? false;
	}

	/**
	 * Checks if a dependency has been instantiated in this scope or any parent scope.
	 *
	 * This method checks the current scope first, then walks up the parent chain.
	 * Returns true if the dependency has been instantiated somewhere in the scope hierarchy.
	 */
	override exists(tag: AnyTag): boolean {
		// Check current scope first
		if (super.exists(tag)) {
			return true;
		}

		// Check parent scopes
		return this.parent?.exists(tag) ?? false;
	}

	/**
	 * Retrieves a dependency instance, resolving from the current scope or parent scopes.
	 *
	 * Resolution strategy:
	 * 1. Check cache in current scope
	 * 2. Check if factory exists in current scope - if so, create instance here
	 * 3. Otherwise, delegate to parent scope
	 * 4. If no parent or parent doesn't have it, throw UnknownDependencyError
	 */
	override async get<T extends TReg>(tag: T): Promise<TagType<T>> {
		// If this scope has a factory, resolve here (uses this scope's cache)
		if (this.factories.has(tag)) {
			return super.get(tag);
		}

		// Otherwise delegate to parent scope if available
		if (this.parent !== null) {
			return this.parent.get(tag);
		}

		// Not found in this scope or any parent
		throw new UnknownDependencyError(tag);
	}

	/**
	 * Destroys this scoped container and its children, preserving the container structure for reuse.
	 *
	 * This method ensures proper cleanup order while maintaining reusability:
	 * 1. Destroys all child scopes first (they may depend on parent scope dependencies)
	 * 2. Then calls finalizers for dependencies created in this scope
	 * 3. Clears only instance caches - preserves factories, finalizers, and child structure
	 *
	 * Child destruction happens first to ensure dependencies don't get cleaned up
	 * before their dependents.
	 */
	override async destroy(): Promise<void> {
		if (this.isDestroyed) {
			return; // Already destroyed, nothing to do
		}

		const allFailures: unknown[] = [];

		// Destroy all child scopes FIRST (they may depend on our dependencies)
		const childDestroyPromises = this.children
			.map((weakRef) => weakRef.deref())
			.filter(
				(child): child is ScopedContainer<TReg> => child !== undefined
			)
			.map((child) => child.destroy());

		const childResults = await Promise.allSettled(childDestroyPromises);

		const childFailures = childResults
			.filter((result) => result.status === 'rejected')
			.map((result) => result.reason as unknown);

		allFailures.push(...childFailures);

		try {
			// Then run our own finalizers
			await super.destroy();
		} catch (error) {
			// Catch our own finalizer failures
			allFailures.push(error);
		} finally {
			// Break parent chain for garbage collection
			this.parent = null;
		}

		// Throw collected errors after cleanup is complete
		if (allFailures.length > 0) {
			throw new DependencyFinalizationError(allFailures);
		}
	}

	/**
	 * Creates a new scoped container by merging this container's registrations with another container.
	 *
	 * This method overrides the base Container.merge to return a ScopedContainer instead of a regular Container.
	 * The resulting scoped container contains all registrations from both containers and becomes a root scope
	 * (no parent) with the scope name from this container.
	 *
	 * @param other - The container to merge with
	 * @returns A new ScopedContainer with combined registrations
	 * @throws {ContainerDestroyedError} If this container has been destroyed
	 */
	override merge<TTarget extends AnyTag>(
		other: Container<TTarget>
	): ScopedContainer<TReg | TTarget> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot merge from a destroyed container'
			);
		}

		// Preserve this container's scope
		const merged = new ScopedContainer<never>(null, this.scope);

		// Copy from other first
		other.copyTo(merged);
		// Then copy from this (will override conflicts)
		this.copyTo(merged);

		return merged as ScopedContainer<TReg | TTarget>;
	}

	/**
	 * Creates a child scoped container.
	 *
	 * Child containers inherit access to parent dependencies but maintain
	 * their own scope for new registrations and instance caching.
	 */
	child(scope: Scope): ScopedContainer<TReg> {
		if (this.isDestroyed) {
			throw new ContainerDestroyedError(
				'Cannot create child containers from a destroyed container'
			);
		}

		const child = new ScopedContainer(this, scope);
		this.children.push(new WeakRef(child));
		return child;
	}
}

/**
 * Converts a regular container into a scoped container, copying all registrations.
 *
 * This function creates a new ScopedContainer instance and copies all factory functions
 * and finalizers from the source container. The resulting scoped container becomes a root
 * scope (no parent) with all the same dependency registrations.
 *
 * **Important**: Only the registrations are copied, not any cached instances.
 * The new scoped container starts with an empty instance cache.
 *
 * @param container - The container to convert to a scoped container
 * @param scope - A string or symbol identifier for this scope (used for debugging)
 * @returns A new ScopedContainer instance with all registrations copied from the source container
 * @throws {ContainerDestroyedError} If the source container has been destroyed
 *
 * @example Converting a regular container to scoped
 * ```typescript
 * import { container, scoped } from 'sandly';
 *
 * const appContainer = container()
 *   .register(DatabaseService, () => new DatabaseService())
 *   .register(ConfigService, () => new ConfigService());
 *
 * const scopedAppContainer = scoped(appContainer, 'app');
 *
 * // Create child scopes
 * const requestContainer = scopedAppContainer.child('request');
 * ```
 *
 * @example Copying complex registrations
 * ```typescript
 * const baseContainer = container()
 *   .register(DatabaseService, () => new DatabaseService())
 *   .register(UserService, {
 *     factory: async (ctx) => new UserService(await ctx.get(DatabaseService)),
 *     finalizer: (service) => service.cleanup()
 *   });
 *
 * const scopedContainer = scoped(baseContainer, 'app');
 * // scopedContainer now has all the same registrations with finalizers preserved
 * ```
 */
export function scoped<TReg extends AnyTag>(
	container: Container<TReg>,
	scope: Scope
): ScopedContainer<TReg> {
	// Create new scoped container (no parent, it becomes the root)
	const emptyScoped = new ScopedContainer<never>(null, scope);

	// Merge all registrations using the scoped container's merge method
	const result = emptyScoped.merge(container);

	return result;
}
