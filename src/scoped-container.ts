import { Container, DependencyLifecycle, IContainer } from './container.js';
import {
	ContainerDestroyedError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from './errors.js';
import { AnyTag, TagType } from './tag.js';
import { Factory, Scope } from './types.js';

export class ScopedContainer<TReg extends AnyTag> extends Container<TReg> {
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
		factoryOrLifecycle:
			| Factory<TagType<T>, TReg>
			| DependencyLifecycle<T, TReg>
	): ScopedContainer<TReg | T> {
		super.register(tag, factoryOrLifecycle);
		return this as ScopedContainer<TReg | T>;
	}

	/**
	 * Checks if a dependency has been registered in this scope or any parent scope.
	 *
	 * This method checks the current scope first, then walks up the parent chain.
	 * Returns true if the dependency has been registered somewhere in the scope hierarchy.
	 */
	override has(tag: AnyTag): tag is TReg {
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
	override exists(tag: TReg): boolean {
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
 * Creates a new scoped dependency injection container with the given scope name.
 *
 * Scoped containers allow hierarchical dependency management where child scopes
 * can inherit dependencies from parent scopes while maintaining their own
 * isolated registrations and instance caches.
 *
 * @param scope - A string identifier for this scope (used for debugging)
 * @returns A new empty ScopedContainer instance
 *
 * @example
 * ```typescript
 * import { scopedContainer, Tag } from 'sandl';
 *
 * const appContainer = scopedContainer('app');
 * const requestContainer = appContainer.child('request');
 *
 * // App-level services
 * appContainer.register(DatabaseService, () => new DatabaseService());
 *
 * // Request-level services that can access app services
 * requestScope.register(UserService, async (container) =>
 *   new UserService(await container.get(DatabaseService))
 * );
 * ```
 */
export function scopedContainer(scope: Scope): ScopedContainer<never> {
	return new ScopedContainer(null, scope);
}
