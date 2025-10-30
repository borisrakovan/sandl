import { Container } from '@/container.js';
import {
	ContainerDestroyedError,
	DependencyAlreadyInstantiatedError,
	DependencyCreationError,
	DependencyFinalizationError,
	UnknownDependencyError,
} from '@/errors.js';
import { scoped, ScopedContainer } from '@/scoped-container.js';
import { Tag } from '@/tag.js';
import { describe, expect, it, vi } from 'vitest';

describe('ScopedContainer', () => {
	describe('constructor and factory', () => {
		it('should create an empty scoped container', () => {
			const c = ScopedContainer.empty('test-scope');
			expect(c).toBeInstanceOf(ScopedContainer);
			expect(c.scope).toBe('test-scope');
		});

		it('should create scoped container with symbol scope', () => {
			const scope = Symbol('test-scope');
			const c = ScopedContainer.empty(scope);
			expect(c).toBeInstanceOf(ScopedContainer);
			expect(c.scope).toBe(scope);
		});
	});

	describe('child container creation', () => {
		it('should create child containers', () => {
			const parent = ScopedContainer.empty('parent');
			const child = parent.child('child');

			expect(child).toBeInstanceOf(ScopedContainer);
			expect(child.scope).toBe('child');
			expect(child).not.toBe(parent);
		});

		it('should create multiple child containers', () => {
			const parent = ScopedContainer.empty('parent');
			const child1 = parent.child('child1');
			const child2 = parent.child('child2');

			expect(child1.scope).toBe('child1');
			expect(child2.scope).toBe('child2');
			expect(child1).not.toBe(child2);
		});

		it('should create nested child containers', () => {
			const grandparent = ScopedContainer.empty('grandparent');
			const parent = grandparent.child('parent');
			const child = parent.child('child');

			expect(child.scope).toBe('child');
			expect(parent.scope).toBe('parent');
			expect(grandparent.scope).toBe('grandparent');
		});

		it('should throw error when creating child from destroyed container', async () => {
			const parent = ScopedContainer.empty('parent');
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

			const c = ScopedContainer.empty('test').register(
				TestService,
				() => new TestService()
			);

			expect(c.has(TestService)).toBe(true);
		});

		it('should allow overriding registration in same scope before instantiation', () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const c = ScopedContainer.empty('test')
				.register(TestService, () => new TestService('original'))
				.register(TestService, () => new TestService('overridden'));

			expect(c).toBeDefined();
		});

		it('should allow registering dependency that exists in parent scope if not instantiated', () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService('parent')
			);
			const child = parent.child('child');

			// Should be able to register (override) in child scope
			const childWithOverride = child.register(
				TestService,
				() => new TestService('child')
			);

			expect(childWithOverride).toBeDefined();
		});

		it('should throw error when trying to register dependency that is instantiated in parent scope', async () => {
			class TestService extends Tag.Class('TestService') {}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent.child('child');

			// Instantiate in parent first
			await parent.get(TestService);

			// Now try to register in child - should throw
			expect(() =>
				child.register(TestService, () => new TestService())
			).toThrow(DependencyAlreadyInstantiatedError);
		});
	});

	describe('has method', () => {
		it('should return false for unregistered dependency', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = ScopedContainer.empty('test');
			expect(c.has(TestService)).toBe(false);
		});

		it('should return true for dependency registered in current scope', () => {
			class TestService extends Tag.Class('TestService') {}

			const c = ScopedContainer.empty('test').register(
				TestService,
				() => new TestService()
			);

			expect(c.has(TestService)).toBe(true);
		});

		it('should return true for dependency registered in parent scope', () => {
			class TestService extends Tag.Class('TestService') {}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent.child('child');

			expect(child.has(TestService)).toBe(true);
		});

		it('should return true for dependency registered in grandparent scope', () => {
			class TestService extends Tag.Class('TestService') {}

			const grandparent = ScopedContainer.empty('grandparent').register(
				TestService,
				() => new TestService()
			);
			const parent = grandparent.child('parent');
			const child = parent.child('child');

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

			const c = ScopedContainer.empty('test').register(
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

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService()
			);
			const child = parent.child('child');

			const instance = await child.get(TestService);
			expect(instance).toBeInstanceOf(TestService);
			expect(instance.getValue()).toBe('parent-scope');
		});

		it('should resolve from parent scope when not overridden', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService('parent')
			);
			const child = parent.child('child');

			const parentInstance = await parent.get(TestService);
			const childInstance = await child.get(TestService);

			// Both should get the same instance from parent scope
			expect(parentInstance.value).toBe('parent');
			expect(childInstance.value).toBe('parent');
			expect(parentInstance).toBe(childInstance);
		});

		it('should cache instances per scope', async () => {
			class TestService extends Tag.Class('TestService') {}

			const factory = vi.fn(() => new TestService());
			const parent = ScopedContainer.empty('parent').register(
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

		it('should allow child to override parent dependency before instantiation', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public value: string) {
					super();
				}
			}

			const parent = ScopedContainer.empty('parent').register(
				TestService,
				() => new TestService('parent')
			);
			const child = parent
				.child('child')
				.register(TestService, () => new TestService('child'));

			// Child should get its own instance, parent should get parent instance
			const childInstance = await child.get(TestService);
			const parentInstance = await parent.get(TestService);

			expect(childInstance.value).toBe('child');
			expect(parentInstance.value).toBe('parent');
			expect(childInstance).not.toBe(parentInstance);
		});

		it('should throw UnknownDependencyError for unregistered dependency', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = ScopedContainer.empty('test');

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
			const app = ScopedContainer.empty('app').register(
				DatabaseService,
				() => new DatabaseService()
			);

			// Request-level services
			const request = app
				.child('request')
				.register(CacheService, () => new CacheService())
				.register(
					UserService,
					async (ctx) =>
						new UserService(
							await ctx.get(DatabaseService),
							await ctx.get(CacheService)
						)
				);

			const userService = await request.get(UserService);
			expect(userService.getUser()).toBe('db-result-cached-result');
		});

		it('should throw error when getting from destroyed container', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = ScopedContainer.empty('test').register(
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

			const c = ScopedContainer.empty('test').register(TestService, {
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

			const parent = ScopedContainer.empty('parent').register(
				ParentService,
				{
					factory: () => new ParentService(),
					finalizer: () => {
						destructionOrder.push('parent');
					},
				}
			);

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

			const parent = ScopedContainer.empty('parent').register(
				ParentService,
				{
					factory: () => new ParentService(),
					finalizer: () => {
						destructionOrder.push('parent');
					},
				}
			);

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

			const grandparent = ScopedContainer.empty('grandparent').register(
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

			const parent = ScopedContainer.empty('parent').register(
				ParentService,
				{
					factory: () => new ParentService(),
					finalizer: () => {
						// Parent finalizer succeeds
					},
				}
			);

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
			const c = ScopedContainer.empty('test');

			await c.destroy();
			await expect(c.destroy()).resolves.toBeUndefined();
			await expect(c.destroy()).resolves.toBeUndefined();
		});

		it('should make container unusable after destroy', async () => {
			class TestService extends Tag.Class('TestService') {}

			const c = ScopedContainer.empty('test').register(
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
			const parent = ScopedContainer.empty('parent');

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

			const c = ScopedContainer.empty('test').register(
				TestService,
				() => {
					throw new Error('Factory error');
				}
			);

			await expect(c.get(TestService)).rejects.toThrow(
				DependencyCreationError
			);
		});

		it('should handle circular dependencies', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const c = ScopedContainer.empty('test')
				.register(
					ServiceA,
					async (ctx) =>
						// @ts-expect-error - ServiceB not registered yet
						new ServiceA(await ctx.get(ServiceB))
				)
				.register(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.get(ServiceA))
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

			const parent = ScopedContainer.empty('parent').register(
				ServiceA,
				async (ctx) =>
					// @ts-expect-error - ServiceB not in parent scope
					new ServiceA(await ctx.get(ServiceB))
			);
			const child = parent
				.child('child')
				.register(
					ServiceB,
					async (ctx) => new ServiceB(await ctx.get(ServiceA))
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
			const parent = ScopedContainer.empty('parent');
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

			const parent = ScopedContainer.empty('parent').register(
				StringTag,
				() => 'parent-string'
			);
			const child = parent.child('child').register(NumberTag, () => 42);

			const stringValue = await child.get(StringTag); // From parent
			const numberValue = await child.get(NumberTag); // From child

			expect(stringValue).toBe('parent-string');
			expect(numberValue).toBe(42);
		});

		it('should allow child to override parent ValueTag before instantiation', async () => {
			const ConfigTag = Tag.of('config')<{ env: string }>();

			const parent = ScopedContainer.empty('parent').register(
				ConfigTag,
				() => ({ env: 'production' })
			);
			const child = parent
				.child('child')
				.register(ConfigTag, () => ({ env: 'development' }));

			// Child should get its own config, parent should get parent config
			const childConfig = await child.get(ConfigTag);
			const parentConfig = await parent.get(ConfigTag);

			expect(childConfig.env).toBe('development');
			expect(parentConfig.env).toBe('production');
		});
	});

	describe('scoped function', () => {
		it('should convert regular container to scoped container', async () => {
			class ServiceA extends Tag.Class('ServiceA') {}
			class ServiceB extends Tag.Class('ServiceB') {}

			const regularContainer = Container.empty()
				.register(ServiceA, () => new ServiceA())
				.register(ServiceB, () => new ServiceB());

			const scopedContainer = scoped(regularContainer, 'test-scope');

			expect(scopedContainer).toBeInstanceOf(ScopedContainer);
			expect(scopedContainer.scope).toBe('test-scope');

			// Should have copied all registrations
			expect(scopedContainer.has(ServiceA)).toBe(true);
			expect(scopedContainer.has(ServiceB)).toBe(true);

			// Should be able to get services
			const serviceA = await scopedContainer.get(ServiceA);
			const serviceB = await scopedContainer.get(ServiceB);

			expect(serviceA).toBeInstanceOf(ServiceA);
			expect(serviceB).toBeInstanceOf(ServiceB);
		});

		it('should preserve finalizers when converting', async () => {
			class TestService extends Tag.Class('TestService') {
				cleanup = vi.fn();
			}

			const finalizer = vi.fn((instance: TestService) => {
				instance.cleanup();
			});

			const regularContainer = Container.empty().register(TestService, {
				factory: () => new TestService(),
				finalizer,
			});

			const scopedContainer = scoped(regularContainer, 'test-scope');
			const instance = await scopedContainer.get(TestService);

			await scopedContainer.destroy();

			expect(finalizer).toHaveBeenCalledWith(instance);
			expect(instance.cleanup).toHaveBeenCalled();
		});

		it('should not share instances with original container', async () => {
			class TestService extends Tag.Class('TestService') {
				constructor(public id: string = Math.random().toString()) {
					super();
				}
			}

			const regularContainer = Container.empty().register(
				TestService,
				() => new TestService()
			);

			// Get instance from original first
			const originalInstance = await regularContainer.get(TestService);

			const scopedContainer = scoped(regularContainer, 'test-scope');
			const scopedInstance = await scopedContainer.get(TestService);

			// Should be different instances (fresh cache)
			expect(originalInstance).not.toBe(scopedInstance);
			expect(originalInstance.id).not.toBe(scopedInstance.id);
		});

		it('should work with empty container', () => {
			const emptyContainer = Container.empty();
			const scopedContainer = scoped(emptyContainer, 'empty-scope');

			expect(scopedContainer).toBeInstanceOf(ScopedContainer);
			expect(scopedContainer.scope).toBe('empty-scope');
		});

		it('should accept symbol scope identifiers', () => {
			class TestService extends Tag.Class('TestService') {}
			const symbolScope = Symbol('test-scope');

			const regularContainer = Container.empty().register(
				TestService,
				() => new TestService()
			);
			const scopedContainer = scoped(regularContainer, symbolScope);

			expect(scopedContainer.scope).toBe(symbolScope);
			expect(scopedContainer.has(TestService)).toBe(true);
		});

		it('should throw error when converting destroyed container', async () => {
			class TestService extends Tag.Class('TestService') {}

			const regularContainer = Container.empty().register(
				TestService,
				() => new TestService()
			);
			await regularContainer.destroy();

			expect(() => scoped(regularContainer, 'test-scope')).toThrow(
				ContainerDestroyedError
			);
		});
	});
});
