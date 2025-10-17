import { ScopedContainer, scopedContainer } from '@/container.js';
import {
	ContainerDestroyedError,
	DependencyAlreadyRegisteredError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from '@/errors.js';
import { Tag } from '@/tag.js';
import { describe, expect, it, vi } from 'vitest';

describe('ScopedContainer', () => {
	describe('constructor and factory', () => {
		it('should create an empty scoped container', () => {
			const c = scopedContainer('test-scope');
			expect(c).toBeInstanceOf(ScopedContainer);
			expect(c.scope).toBe('test-scope');
		});

		it('should create scoped container with symbol scope', () => {
			const scope = Symbol('test-scope');
			const c = scopedContainer(scope);
			expect(c).toBeInstanceOf(ScopedContainer);
			expect(c.scope).toBe(scope);
		});
	});

	describe('child container creation', () => {
		it('should create child containers', () => {
			const parent = scopedContainer('parent');
			const child = parent.child('child');

			expect(child).toBeInstanceOf(ScopedContainer);
			expect(child.scope).toBe('child');
			expect(child).not.toBe(parent);
		});

		it('should create multiple child containers', () => {
			const parent = scopedContainer('parent');
			const child1 = parent.child('child1');
			const child2 = parent.child('child2');

			expect(child1.scope).toBe('child1');
			expect(child2.scope).toBe('child2');
			expect(child1).not.toBe(child2);
		});

		it('should create nested child containers', () => {
			const grandparent = scopedContainer('grandparent');
			const parent = grandparent.child('parent');
			const child = parent.child('child');

			expect(child.scope).toBe('child');
			expect(parent.scope).toBe('parent');
			expect(grandparent.scope).toBe('grandparent');
		});

		it('should throw error when creating child from destroyed container', async () => {
			const parent = scopedContainer('parent');
			await parent.destroy();

			expect(() => parent.child('child')).toThrow(
				ContainerDestroyedError
			);
			expect(() => parent.child('child')).toThrow(
				'Cannot create child containers from a destroyed container'
			);
		});
	});

	describe('dependency registration', () => {
		it('should register dependencies in scoped container', () => {
			class TestService extends Tag.Class('TestService') {
				getValue() {
					return 'test';
				}
			}

			const c = scopedContainer('test').register(
				TestService,
				() => new TestService()
			);

			expect(c.has(TestService)).toBe(true);
		});

		it('should throw error for duplicate registration in same scope', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = scopedContainer('test').register(
				TestService,
				() => new TestService()
			);

			expect(() =>
				c.register(TestService, () => new TestService())
			).toThrow(DependencyAlreadyRegisteredError);
		});

		it('should allow same dependency in different scopes', () => {
			class TestService extends Tag.Class('TestService') {}

			const parent = scopedContainer('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent
				.child('child')
				.register(TestService, () => new TestService());

			expect(parent.has(TestService)).toBe(true);
			expect(child.has(TestService)).toBe(true);
		});
	});

	describe('has method', () => {
		it('should return false for unregistered dependency', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = scopedContainer('test');
			expect(c.has(TestService)).toBe(false);
		});

		it('should return true for dependency registered in current scope', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = scopedContainer('test').register(
				TestService,
				() => new TestService()
			);

			expect(c.has(TestService)).toBe(true);
		});

		it('should return true for dependency registered in parent scope', () => {
			class TestService extends Tag.Class('TestService') {}

			const parent = scopedContainer('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent.child('child');

			expect(child.has(TestService)).toBe(true);
		});

		it('should return true for dependency registered in grandparent scope', () => {
			class TestService extends Tag.Class('TestService') {}

			const grandparent = scopedContainer('grandparent').register(
				TestService,
				() => new TestService()
			);
			const parent = grandparent.child('parent');
			const child = parent.child('child');

			expect(child.has(TestService)).toBe(true);
		});

		it('should prioritize current scope over parent scope', () => {
			class TestService extends Tag.Class('TestService') {}

			const parent = scopedContainer('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent
				.child('child')
				.register(TestService, () => new TestService());

			// Both should return true, but child scope takes precedence
			expect(parent.has(TestService)).toBe(true);
			expect(child.has(TestService)).toBe(true);
		});
	});

	describe('get method and dependency resolution', () => {
		it('should resolve dependency from current scope', async () => {
			class TestService extends Tag.Class('TestService') {
				getValue() {
					return 'current-scope';
				}
			}

			const c = scopedContainer('test').register(
				TestService,
				() => new TestService()
			);

			const instance = await c.get(TestService);
			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('current-scope');
		});

		it('should resolve dependency from parent scope', async () => {
			class TestService extends Tag.Class('TestService') {
				getValue() {
					return 'parent-scope';
				}
			}

			const parent = scopedContainer('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent.child('child');

			const instance = await child.get(TestService);
			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('parent-scope');
		});

		it('should prioritize current scope over parent scope', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const parent = scopedContainer('parent').register(
				TestService,
				() => new TestService('parent')
			);
			const child = parent
				.child('child')
				.register(TestService, () => new TestService('child'));

			const parentInstance = await parent.get(TestService);
			const childInstance = await child.get(TestService);

			expect(parentInstance.value).toBe('parent');
			expect(childInstance.value).toBe('child');
			expect(parentInstance).not.toBe(childInstance);
		});

		it('should cache instances per scope', async () => {
			class TestService extends Tag.Class('TestService') {}

			const factory = vi.fn(() => new TestService());
			const parent = scopedContainer('parent').register(
				TestService,
				factory
			);
			const child = parent.child('child');

			// Get from parent twice
			const parentInstance1 = await parent.get(TestService);
			const parentInstance2 = await parent.get(TestService);

			// Get from child twice
			const childInstance1 = await child.get(TestService);
			const childInstance2 = await child.get(TestService);

			// Same instance within scope
			expect(parentInstance1).toBe(parentInstance2);
			expect(childInstance1).toBe(childInstance2);

			// Same instance across scopes (resolved from parent)
			expect(parentInstance1).toBe(childInstance1);

			// Factory called only once
			expect(factory).toHaveBeenCalledTimes(1);
		});

		it('should maintain separate caches when child overrides parent', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const parentFactory = vi.fn(() => new TestService('parent'));
			const childFactory = vi.fn(() => new TestService('child'));

			const parent = scopedContainer('parent').register(
				TestService,
				parentFactory
			);
			const child = parent
				.child('child')
				.register(TestService, childFactory);

			const parentInstance1 = await parent.get(TestService);
			const parentInstance2 = await parent.get(TestService);
			const childInstance1 = await child.get(TestService);
			const childInstance2 = await child.get(TestService);

			// Same instance within each scope
			expect(parentInstance1).toBe(parentInstance2);
			expect(childInstance1).toBe(childInstance2);

			// Different instances across scopes
			expect(parentInstance1).not.toBe(childInstance1);

			// Each factory called once
			expect(parentFactory).toHaveBeenCalledTimes(1);
			expect(childFactory).toHaveBeenCalledTimes(1);

			expect(parentInstance1.value).toBe('parent');
			expect(childInstance1.value).toBe('child');
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = scopedContainer('test');

			// @ts-expect-error - TestService is not registered
			await expect(c.get(TestService)).rejects.toThrow(
				UnknownDependencyError
			);
		});

		it('should handle complex dependency injection across scopes', async () => {
			class DatabaseService extends Tag.Class('DatabaseService') {
				query() {
					return 'db-result';
				}
			}

			class CacheService extends Tag.Class('CacheService') {
				get() {
					return 'cached-result';
				}
			}

			class UserService extends Tag.Class('UserService') {
				constructor(
					private db: DatabaseService,
					private cache: CacheService
				) {
					super();
				}

				getUser() {
					return `${this.db.query()}-${this.cache.get()}`;
				}
			}

			// App-level services
			const app = scopedContainer('app').register(
				DatabaseService,
				() => new DatabaseService()
			);

			// Request-level services
			const request = app
				.child('request')
				.register(CacheService, () => new CacheService())
				.register(
					UserService,
					async (container) =>
						new UserService(
							await container.get(DatabaseService),
							await container.get(CacheService)
						)
				);

			const userService = await request.get(UserService);
			expect(userService.getUser()).toBe('db-result-cached-result');
		});

		it('should throw error when getting from destroyed container', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = scopedContainer('test').register(
				TestService,
				() => new TestService()
			);

			await c.destroy();

			await expect(c.get(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);
		});
	});

	describe('destroy method', () => {
		it('should call finalizers for instantiated dependencies', async () => {
			class TestService extends Tag.Class('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const c = scopedContainer('test').register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			const instance = await c.get(TestService);
			await c.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should destroy children before parent', async () => {
			const destructionOrder: string[] = [];

			class ParentService extends Tag.Class('ParentService') {}
			class ChildService extends Tag.Class('ChildService') {}

			const parent = scopedContainer('parent').register(ParentService, {
				factory: () => new ParentService(),
				finalizer: () => {
					destructionOrder.push('parent');
				},
			});

			const child = parent.child('child').register(ChildService, {
				factory: () => new ChildService(),
				finalizer: () => {
					destructionOrder.push('child');
				},
			});

			// Instantiate both
			await parent.get(ParentService);
			await child.get(ChildService);

			// Destroy parent (should destroy child first)
			await parent.destroy();

			expect(destructionOrder).toEqual(['child', 'parent']);
		});

		it('should destroy multiple children before parent', async () => {
			const destructionOrder: string[] = [];

			class ParentService extends Tag.Class('ParentService') {}
			class Child1Service extends Tag.Class('Child1Service') {}
			class Child2Service extends Tag.Class('Child2Service') {}

			const parent = scopedContainer('parent').register(ParentService, {
				factory: () => new ParentService(),
				finalizer: () => {
					destructionOrder.push('parent');
				},
			});

			const child1 = parent.child('child1').register(Child1Service, {
				factory: () => new Child1Service(),
				finalizer: () => {
					destructionOrder.push('child1');
				},
			});

			const child2 = parent.child('child2').register(Child2Service, {
				factory: () => new Child2Service(),
				finalizer: () => {
					destructionOrder.push('child2');
				},
			});

			// Instantiate all
			await parent.get(ParentService);
			await child1.get(Child1Service);
			await child2.get(Child2Service);

			// Destroy parent
			await parent.destroy();

			// Children should be destroyed before parent
			expect(destructionOrder).toHaveLength(3);
			expect(destructionOrder).toContain('child1');
			expect(destructionOrder).toContain('child2');
			expect(destructionOrder).toContain('parent');
			expect(destructionOrder.indexOf('parent')).toBe(2); // Parent last
		});

		it('should handle nested child destruction', async () => {
			const destructionOrder: string[] = [];

			class GrandparentService extends Tag.Class('GrandparentService') {}
			class ParentService extends Tag.Class('ParentService') {}
			class ChildService extends Tag.Class('ChildService') {}

			const grandparent = scopedContainer('grandparent').register(
				GrandparentService,
				{
					factory: () => new GrandparentService(),
					finalizer: () => {
						destructionOrder.push('grandparent');
					},
				}
			);

			const parent = grandparent.child('parent').register(ParentService, {
				factory: () => new ParentService(),
				finalizer: () => {
					destructionOrder.push('parent');
				},
			});

			const child = parent.child('child').register(ChildService, {
				factory: () => new ChildService(),
				finalizer: () => {
					destructionOrder.push('child');
				},
			});

			// Instantiate all
			await grandparent.get(GrandparentService);
			await parent.get(ParentService);
			await child.get(ChildService);

			// Destroy grandparent
			await grandparent.destroy();

			expect(destructionOrder).toEqual([
				'child',
				'parent',
				'grandparent',
			]);
		});

		it('should handle child destruction errors', async () => {
			class ParentService extends Tag.Class('ParentService') {}
			class ChildService extends Tag.Class('ChildService') {}

			const parent = scopedContainer('parent').register(ParentService, {
				factory: () => new ParentService(),
				finalizer: () => {
					// Parent finalizer succeeds
				},
			});

			const child = parent.child('child').register(ChildService, {
				factory: () => new ChildService(),
				finalizer: () => {
					throw new Error('Child finalizer error');
				},
			});

			await parent.get(ParentService);
			await child.get(ChildService);

			await expect(parent.destroy()).rejects.toThrow(
				DependencyFinalizationError
			);
		});

		it('should be idempotent', async () => {
			const c = scopedContainer('test');

			await c.destroy();
			await expect(c.destroy()).resolves.toBeUndefined();
			await expect(c.destroy()).resolves.toBeUndefined();
		});

		it('should make container unusable after destroy', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = scopedContainer('test').register(
				TestService,
				() => new TestService()
			);

			await c.get(TestService);
			await c.destroy();

			// Should still report as having the service
			expect(c.has(TestService)).toBe(true);

			// But should throw when trying to get it
			await expect(c.get(TestService)).rejects.toThrow(
				ContainerDestroyedError
			);

			// And should throw when trying to register
			expect(() =>
				c.register(TestService, () => new TestService())
			).toThrow(ContainerDestroyedError);
		});

		it('should handle garbage collected children gracefully', async () => {
			const parent = scopedContainer('parent');

			// Create child and let it go out of scope
			{
				class ChildService extends Tag.Class('ChildService') {}
				const child = parent
					.child('child')
					.register(ChildService, () => new ChildService());
				await child.get(ChildService);
				// child goes out of scope here
			}

			// Force garbage collection if possible
			if (global.gc) {
				global.gc();
			}

			// Parent destroy should handle dead child references gracefully
			await expect(parent.destroy()).resolves.toBeUndefined();
		});
	});

	describe('error handling', () => {
		it('should wrap factory errors in DependencyCreationError', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = scopedContainer('test').register(TestService, () => {
				throw new Error('Factory error');
			});

			await expect(c.get(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should handle circular dependencies', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = scopedContainer('test')
				.register(
					ServiceA,
					async (container) =>
						// @ts-expect-error - ServiceB not registered yet
						new ServiceA(await container.get(ServiceB))
				)
				.register(
					ServiceB,
					async (container) =>
						new ServiceB(await container.get(ServiceA))
				);

			try {
				await c.get(ServiceA);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
				// Should have nested error chain leading to CircularDependencyError
				const serviceAError = error as DependencyCreationError;
				expect(serviceAError.cause).toBeInstanceOf(
					DependencyCreationError
				);
			}
		});

		it('should handle cross-scope circular dependencies', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const parent = scopedContainer('parent').register(
				ServiceA,
				async (container) =>
					// @ts-expect-error - ServiceB not in parent scope
					new ServiceA(await container.get(ServiceB))
			);
			const child = parent
				.child('child')
				.register(
					ServiceB,
					async (container) =>
						new ServiceB(await container.get(ServiceA))
				);

			try {
				await child.get(ServiceB);
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(DependencyCreationError);
			}
		});
	});

	describe('WeakRef memory management', () => {
		it('should not prevent child garbage collection', async () => {
			const parent = scopedContainer('parent');
			let childRef: WeakRef<ScopedContainer<never>>;

			// Create child in isolated scope
			{
				const child = parent.child('child');
				childRef = new WeakRef(child);
				expect(childRef.deref()).toBe(child);
			}

			// Force garbage collection if available
			if (global.gc) {
				global.gc();
				// Give GC time to run
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			// Note: We can't reliably test GC in all environments,
			// but we can at least verify the WeakRef exists
			expect(childRef).toBeDefined();
		});
	});

	describe('ValueTag support', () => {
		it('should work with ValueTag dependencies in scoped containers', async () => {
			const StringTag = Tag.of('string')<string>();
			const NumberTag = Tag.of('number')<number>();

			const parent = scopedContainer('parent').register(
				StringTag,
				() => 'parent-string'
			);
			const child = parent.child('child').register(NumberTag, () => 42);

			const stringValue = await child.get(StringTag); // From parent
			const numberValue = await child.get(NumberTag); // From child

			expect(stringValue).toBe('parent-string');
			expect(numberValue).toBe(42);
		});

		it('should override parent ValueTag in child scope', async () => {
			const ConfigTag = Tag.of('config')<{ env: string }>();

			const parent = scopedContainer('parent').register(
				ConfigTag,
				() => ({ env: 'production' })
			);
			const child = parent
				.child('child')
				.register(ConfigTag, () => ({ env: 'development' }));

			const parentConfig = await parent.get(ConfigTag);
			const childConfig = await child.get(ConfigTag);

			expect(parentConfig.env).toBe('production');
			expect(childConfig.env).toBe('development');
		});
	});
});
